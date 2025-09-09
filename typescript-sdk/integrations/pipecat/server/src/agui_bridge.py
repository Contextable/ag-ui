"""
AG-UI Bridge for Pipecat

This module provides an Observer that bridges Pipecat pipelines with the AG-UI protocol,
enabling real-time streaming of AI agent interactions to web clients via Server-Sent Events.

Installation:
    pip install ag-ui-core ag-ui-encoder

Usage in a Pipecat server:

```python
from agui_bridge import AGUIObserver
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.pipeline.runner import PipelineRunner
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from ag_ui.core import RunAgentInput

# Create the AG-UI observer
agui_observer = AGUIObserver(debug=True, max_memory_mb=50)

# Create pipeline
pipeline = Pipeline([...])

# Create task with AG-UI observer
task = PipelineTask(
    pipeline, 
    params=PipelineParams(allow_interruptions=True),
    observers=[agui_observer]
)

# Add AG-UI endpoint to your WebSocket server's FastAPI app
@app.post("/sse")
async def handle_agui_run(input_data: RunAgentInput):
    # Inject user messages from AG-UI into pipeline
    for message in input_data.messages:
        if message.role == "user":
            text_frame = TextFrame(text=message.content)
            await task.queue_frame(text_frame)
    
    # Return SSE stream of AG-UI events
    return StreamingResponse(
        agui_observer.get_sse_stream(),
        media_type="text/event-stream"
    )

# Run pipeline
runner = PipelineRunner()
await runner.run(task)
```
"""

import asyncio
import json
import logging
import uuid
from typing import Any, Optional, AsyncGenerator
import time

# Import AG-UI event types from the published library
from ag_ui.core.events import (
    EventType,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    ToolCallStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    CustomEvent,
    RunStartedEvent,
    RunFinishedEvent,
    RunErrorEvent,
    BaseEvent
)
from ag_ui.encoder.encoder import EventEncoder

# Import Pipecat frame types
from pipecat.frames.frames import (
    Frame, TextFrame, LLMTextFrame, TranscriptionFrame, InterimTranscriptionFrame,
    FunctionCallsStartedFrame, FunctionCallInProgressFrame, FunctionCallResultFrame,
    LLMFullResponseStartFrame, LLMFullResponseEndFrame,
    TTSSpeakFrame, UserStartedSpeakingFrame, UserStoppedSpeakingFrame,
    BotStartedSpeakingFrame, BotStoppedSpeakingFrame,
    StartFrame, EndFrame, CancelFrame, ErrorFrame,
    LLMMessagesFrame, SystemFrame
)
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.frame_processor import FrameDirection
from pipecat.observers.base_observer import BaseObserver, FrameProcessed


logger = logging.getLogger(__name__)


class AGUIObserver(BaseObserver):
    """
    AG-UI Observer that watches Pipecat pipeline events and converts them to AG-UI events.
    
    This observer integrates with PipelineTask to monitor frame processing and emit
    corresponding AG-UI events via Server-Sent Events for web clients.
    """
    
    def __init__(self, debug: bool = False, max_memory_mb: int = 100):
        super().__init__()
        self.debug = debug
        self.run_id = str(uuid.uuid4())
        self.thread_id = str(uuid.uuid4())
        
        # AG-UI encoder for SSE streaming
        self.encoder = EventEncoder()
        
        # State tracking
        self.current_message_id: Optional[str] = None
        self.current_tool_call_id: Optional[str] = None
        self.is_streaming = False
        self.is_shutdown = False
        
        # Tool call flow tracking
        self.pending_tool_calls = 0  # Track number of tool calls in progress
        self._run_finished_sent = False  # Track if RUN_FINISHED already sent for this run
        self.llm_responses_after_tools = 0  # Track LLM responses after tool execution
        self._has_had_tool_calls = False  # Track if we've had tool calls in this conversation
        self._processed_tool_call_ids = set()  # Track processed tool call IDs to prevent duplicates
        
        # Deferred events for important CustomEvents during text streaming
        self.deferred_events: list = []
        
        # Event streaming with memory monitoring
        self.event_queue: asyncio.Queue = asyncio.Queue()  # Unbounded queue
        self.max_memory_bytes = max_memory_mb * 1024 * 1024
        self.current_memory_usage = 0
        
        # Error tracking and recovery
        self.error_count = 0
        self.max_errors = 10
        
        # Frame deduplication tracking
        self.processed_text_chunks = set()  # Track processed text content to prevent duplicates
        self.last_frame_id = None  # Track last frame ID
        self.run_finished = False  # Track if we've already sent RUN_FINISHED for current message
        
        # Message and tool result tracking to prevent duplicates
        self.processed_message_ids = set()  # Track processed message IDs
        self.processed_tool_result_ids = set()  # Track processed tool result IDs
        
        # Tool call metadata storage for FunctionCallResultFrame construction
        self.tool_call_metadata = {}  # Map tool_call_id -> {function_name, arguments}
        
        # Client-side tools for current run (updated dynamically)
        self.current_client_tool_names = set()
        
        # Message count tracking for detecting client resets
        self.last_message_count = 0
        
        self._log(f"Initialized AG-UI Observer - Run ID: {self.run_id}, Max Memory: {max_memory_mb}MB")
    
    async def on_task_started(self, task: PipelineTask):
        """Called when pipeline task starts"""
        await self._start_stream()
    
    async def on_task_ended(self, task: PipelineTask):
        """Called when pipeline task ends"""
        await self._end_stream()
    
    def set_client_tools(self, client_tools: list):
        """Update the list of client-side tools for the current run"""
        if client_tools:
            self.current_client_tool_names = {tool.name for tool in client_tools}
            logger.info(f"Updated client tools: {self.current_client_tool_names}")
        else:
            self.current_client_tool_names = set()
            logger.info("Cleared client tools")
    
    async def on_push_frame(self, data):
        """Called when a frame is pushed through the pipeline (Pipecat 0.0.83+ method)"""
        if self.is_shutdown or self.run_finished:
            return

        frame = data.frame
        direction = getattr(data, 'direction', None)

        logger.debug(f"[FRAME_DEBUG] Received frame: {type(frame).__name__}")

        try:
            # Handle system frames
            if isinstance(frame, StartFrame):
                self._log("Pipeline started, but not auto-starting AG-UI stream")
            elif isinstance(frame, (EndFrame, CancelFrame)):
                if not self.run_finished:
                    logger.info(f"Pipeline task ended ({type(frame).__name__}). Finishing run.")
                    await self._finish_run({"status": "completed", "type": "pipeline_ended"})
                else:
                    logger.info(f"Pipeline task ended ({type(frame).__name__}), but run was already finished. No action needed.")
            elif isinstance(frame, ErrorFrame):
                await self._handle_error(frame)

            # Handle user frames (UPSTREAM)
            # Disabled transcription events to rule out as interference with tool calls
            # elif isinstance(frame, TranscriptionFrame):
            #     await self._handle_user_transcription(frame, final=True)
            # elif isinstance(frame, InterimTranscriptionFrame):
            #     await self._handle_user_transcription(frame, final=False)

            # Handle assistant frames (DOWNSTREAM)
            elif isinstance(frame, LLMFullResponseStartFrame):
                logger.info(f"[LLM_OUTPUT] LLM started generating response")
                await self._start_text_message("assistant")
            
            elif isinstance(frame, LLMTextFrame):
                # Deduplicate LLMTextFrame chunks that may flow through pipeline multiple times
                if frame.text not in self.processed_text_chunks:
                    self.processed_text_chunks.add(frame.text)
                    logger.info(f"[LLM_OUTPUT] LLM generated text chunk (LLMTextFrame): '{frame.text}'")
                    await self._add_text_content(frame.text)
                else:
                    logger.debug(f"[LLM_OUTPUT] Skipping duplicate LLMTextFrame: '{frame.text}'")

            elif isinstance(frame, LLMFullResponseEndFrame):
                logger.info(f"[LLM_OUTPUT] LLM finished generating response")
                await self._end_current_message()

                # Check what type of response this was and handle accordingly
                if self._run_finished_sent:
                    # RUN_FINISHED already sent for client-side tools, but still need to close stream
                    logger.info(f"[LLM_OUTPUT] LLM response completed, RUN_FINISHED already sent for client tools - closing stream without duplicate message")
                    self.run_finished = True  # Mark as finished to prevent other issues
                    await self._close_stream()
                elif self.pending_tool_calls == 0 and not self._has_had_tool_calls:
                    # Simple text response with no tool calls - do soft finish
                    logger.info(f"[LLM_OUTPUT] Simple text response completed - finishing run")
                    await self._finish_run({"status": "completed", "type": "simple_response"})
                elif self.pending_tool_calls == 0 and self._has_had_tool_calls:
                    # Final response AFTER SERVER-SIDE tools have executed
                    logger.info(f"[TOOL_FLOW] Final LLM response after server tool calls completed - finishing run")
                    await self._finish_run({"status": "completed", "type": "final_llm_response"})
                else:
                    # Tool calls are pending (either client or server)
                    # For client-side tools, the soft finish has already been sent
                    # For server-side tools, we wait for them to complete
                    logger.info(f"[LLM_OUTPUT] LLM response completed with {self.pending_tool_calls} tool calls pending")

            elif isinstance(frame, TextFrame):
                # Skip regular TextFrame - we only want LLM-generated text
                logger.info(f"[SKIP] Ignoring non-LLM TextFrame: '{frame.text}'")

            # Handle tool call frames
            elif isinstance(frame, FunctionCallsStartedFrame):
                logger.info(f"[TOOL_FLOW] FunctionCallsStartedFrame detected: {len(frame.function_calls)} calls")
                
                client_tool_calls = []
                server_tool_calls = []
                
                # Separate client-side vs server-side tool calls
                for func_call in frame.function_calls:
                    tool_call_id = getattr(func_call, "tool_call_id", None)
                    function_name = getattr(func_call, "function_name", None)
                    
                    if tool_call_id and function_name:
                        # Check for duplicates
                        if tool_call_id in self._processed_tool_call_ids:
                            logger.warning(f"[TOOL_FLOW] Skipping duplicate tool call ID: {tool_call_id}")
                            continue
                        
                        self._processed_tool_call_ids.add(tool_call_id)
                        
                        # Store tool call metadata for FunctionCallResultFrame construction
                        arguments = getattr(func_call, "arguments", {})
                        self.tool_call_metadata[tool_call_id] = {
                            "function_name": function_name,
                            "arguments": arguments
                        }
                        logger.debug(f"[TOOL_METADATA] Stored metadata for {tool_call_id}: {function_name} with args {arguments}")
                        
                        # Check if this is a client-side tool
                        if function_name in self.current_client_tool_names:
                            logger.info(f"[TOOL_FLOW] Tool '{function_name}' is CLIENT-SIDE: {tool_call_id}")
                            client_tool_calls.append(func_call)
                        else:
                            logger.info(f"[TOOL_FLOW] Tool '{function_name}' is SERVER-SIDE: {tool_call_id}")
                            server_tool_calls.append(func_call)
                
                # Process client-side tools: send to client and soft finish
                if client_tool_calls:
                    # Mark that we've had tool calls to prevent premature stream closure
                    self._has_had_tool_calls = True
                    await self._end_current_message()
                    
                    for func_call in client_tool_calls:
                        tool_call_id = getattr(func_call, "tool_call_id", None)
                        function_name = getattr(func_call, "function_name", None)
                        args = getattr(func_call, "arguments", None)
                        
                        await self._handle_tool_call_start(tool_call_id, function_name)
                        if args:
                            await self._handle_tool_call_args(tool_call_id, args)
                        await self._handle_tool_call_end(tool_call_id)
                        
                        logger.info(f"[TOOL_FLOW] Client tool call {tool_call_id} sent to client for processing")
                    
                    # Use "soft finish" to signal client to execute tools while keeping pipeline active
                    await self._send_run_finished_event({"status": "awaiting_tool_results", "type": "tool_calls_sent"})
                    self._run_finished_sent = True  # Mark that we've sent RUN_FINISHED for this run
                
                # Process server-side tools: track for state management
                if server_tool_calls:
                    logger.info(f"[TOOL_FLOW] {len(server_tool_calls)} server-side tool calls will execute on server")
                    for func_call in server_tool_calls:
                        tool_call_id = getattr(func_call, "tool_call_id", None)
                        function_name = getattr(func_call, "function_name", None)
                        if tool_call_id and function_name:
                            self.pending_tool_calls += 1
                            self._has_had_tool_calls = True
                            logger.info(f"[TOOL_FLOW] Processing server tool call: {function_name} (ID: {tool_call_id}), pending={self.pending_tool_calls}")
                            await self._handle_tool_call_start(tool_call_id, function_name)

            elif isinstance(frame, FunctionCallInProgressFrame):
                # Log for debugging but don't generate AG-UI events
                logger.info(f"[TOOL_FLOW] Tool call in progress: {frame.function_name} (ID: {frame.tool_call_id}) - ignoring for AG-UI events")
                
            elif isinstance(frame, FunctionCallResultFrame):
                # Handle server-side tool call results
                result_key = f"{frame.tool_call_id}_result"
                if result_key not in self._processed_tool_call_ids:
                    self._processed_tool_call_ids.add(result_key)
                    self.pending_tool_calls = max(0, self.pending_tool_calls - 1)
                    logger.info(f"[TOOL_FLOW] Tool call result received, pending_tool_calls={self.pending_tool_calls}")
                    await self._handle_tool_call_result(frame.tool_call_id, frame.result)
                    logger.info(f"[TOOL_CALL] Tool call completed, but not finishing run - waiting for final LLM response")
                else:
                    logger.info(f"[TOOL_FLOW] Skipping duplicate tool call result: {frame.tool_call_id}")

            elif isinstance(frame, BotStartedSpeakingFrame):
                # Skip - real-time audio feedback that loses meaning if deferred
                pass
            elif isinstance(frame, BotStoppedSpeakingFrame):
                # Skip - real-time audio feedback that loses meaning if deferred
                pass

            # Reset error count on successful processing
            self.error_count = 0

        except Exception as e:
            self.error_count += 1
            self._log(f"Error processing frame {type(frame).__name__}: {e} (error count: {self.error_count})")
            await self._handle_frame_error(e, frame)
            if self.error_count >= self.max_errors:
                self._log(f"Max error count exceeded ({self.max_errors}), shutting down observer")
                await self._unexpected_shutdown("Too many errors occurred")

    async def _start_stream(self):
        """Start AG-UI event streaming"""
        if self.is_streaming:
            return
        
        # Only send RUN_STARTED if we're not in the middle of a text message
        if not self.current_message_id:
            event = RunStartedEvent(
                thread_id=self.thread_id,
                run_id=self.run_id,
                timestamp=self._get_timestamp()
            )
            
            await self._send_agui_event(event)
            self._log("Started AG-UI event streaming with RUN_STARTED")
        else:
            self._log("Started AG-UI event streaming (skipped RUN_STARTED - in text message)")
            
        self.is_streaming = True
    
    async def _send_run_finished_event(self, result: Any = None):
        """
        Send only the RUN_FINISHED event for AG-UI without ending the Pipecat stream.
        This is a "soft finish" that signals the client to execute tools while keeping
        the pipeline active to receive tool results.
        """
        if self.run_finished:  # Still check to avoid duplicate FINISH events
            return

        event = RunFinishedEvent(
            thread_id=self.thread_id,
            run_id=self.run_id,
            result=result,
            timestamp=self._get_timestamp()
        )
        
        await self._send_agui_event(event)
        self._log(f"Sent AG-UI RUN_FINISHED event (soft finish): {result}")
        # CRUCIALLY, DO NOT set self.run_finished = True or self.is_streaming = False here
    
    async def _finish_run(self, result: Any = None):
        """
        Send run finished event and then close the stream.
        This ensures RUN_FINISHED is sent before the SSE connection closes.
        """
        if not self.is_streaming or self.run_finished:
            return
        
        # Send the RUN_FINISHED event BEFORE marking as finished
        await self._send_run_finished_event(result)  # Send the RUN_FINISHED event
        
        # Now mark as finished to prevent duplicates
        self.run_finished = True
        
        # Close the stream after RUN_FINISHED is sent - this signals completion to the client
        await self._close_stream()
    
    async def _close_stream(self):
        """Close the stream without sending additional events"""
        if not self.is_streaming:
            return
        
        # End current message if active
        if self.current_message_id:
            await self._end_current_message()
        
        # Mark stream as closed - this will cause get_sse_stream() to exit
        self.is_streaming = False
        self._log("Closed AG-UI event streaming - SSE connection will close")
    
    async def full_reset(self, accept_header=None):
        """
        Performs a complete reset of all state, including persistent IDs.
        This should be called when a client-side reset is detected.
        """
        self._log("!!! Performing full state reset due to client reset detection !!!")
        
        # Clear ALL persistent state
        self.processed_message_ids.clear()
        self.processed_tool_result_ids.clear()
        self.tool_call_metadata.clear()
        self.last_message_count = 0
        
        # Then do the normal reset
        await self.reset_for_new_run(accept_header)
    
    async def reset_for_new_run(self, accept_header=None):
        """
        Resets observer state for a new run, or extends existing run if still active.
        This should be called at the beginning of a new SSE request.
        """
        # Check if there's already an active run that hasn't finished
        if self.is_streaming and not self.run_finished:
            self._log(f"!!! EXTENDING existing run {self.run_id} instead of creating new run !!!")
            # Don't reset - just continue with the existing run
            # The new messages will be processed as part of the current run
            # Just reinitialize the encoder to handle the new SSE request
            from ag_ui.encoder import EventEncoder
            self.encoder = EventEncoder(accept=accept_header)
            self._log(f"Reinitialized encoder for existing run {self.run_id}")
            return
            
        self._log("!!! Resetting observer state for a new run !!!")

        # 1. Asynchronously drain any stale events from the queue
        while not self.event_queue.empty():
            try:
                self.event_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        
        # 2. Reinitialize encoder with proper accept header for this request
        from ag_ui.encoder import EventEncoder
        self.encoder = EventEncoder(accept=accept_header)
        self._log(f"Reinitialized encoder with accept header: {accept_header}")
        
        # 3. Reset all state-tracking variables
        self.run_id = str(uuid.uuid4())
        self.current_message_id: Optional[str] = None
        self.current_tool_call_id: Optional[str] = None
        self.is_streaming = False
        self.run_finished = False  # Very important
        self.deferred_events.clear()
        self.processed_text_chunks.clear()

        # 4. Reset metrics and counters
        self.current_memory_usage = 0
        self.error_count = 0
        
        # 5. Reset tool call flow tracking
        self.pending_tool_calls = 0
        self.llm_responses_after_tools = 0
        self._has_had_tool_calls = False
        self._processed_tool_call_ids.clear()  # Clear processed tool call IDs for new run
        self._run_finished_sent = False  # Reset RUN_FINISHED flag for new run
        # NOTE: Do NOT clear processed_message_ids or processed_tool_result_ids
        # They must persist across runs to prevent infinite loops when the client
        # sends back message history and tool results in subsequent requests
        
        self._log(f"Observer reset. New Run ID: {self.run_id}")
    
    async def _end_stream(self, result: Any = None):
        """End AG-UI event streaming"""
        if not self.is_streaming:
            return
        
        # End current message if active
        if self.current_message_id:
            await self._end_current_message()
        
        # Send run finished event
        event = RunFinishedEvent(
            thread_id=self.thread_id,
            run_id=self.run_id,
            result=result,
            timestamp=self._get_timestamp()
        )
        
        await self._send_agui_event(event)
        self.is_streaming = False
        self._log("Ended AG-UI event streaming")
    
    async def _handle_error(self, error_frame: ErrorFrame):
        """Handle error frames"""
        event = RunErrorEvent(
            message=str(error_frame.error) if hasattr(error_frame, 'error') else "Unknown error",
            timestamp=self._get_timestamp()
        )
        await self._send_agui_event(event)
    
    async def _handle_frame_error(self, error: Exception, frame: Frame):
        """Handle errors that occur during frame processing"""
        try:
            error_data = {
                "error": str(error),
                "frame_type": type(frame).__name__,
                "error_count": self.error_count
            }
            await self._send_or_defer_custom_event("frame_processing_error", error_data)
        except Exception as e:
            # If we can't even send the error event, just log it
            self._log(f"Failed to send frame error event: {e}")
    
    async def _unexpected_shutdown(self, reason: str):
        """Unexpected shutdown of the observer"""
        try:
            self.is_shutdown = True
            
            # End current message if active
            if self.current_message_id:
                await self._end_current_message()
            
            # Send shutdown event
            event = RunErrorEvent(
                message=f"Observer unexpected shutdown: {reason}",
                timestamp=self._get_timestamp()
            )
            await self._send_agui_event(event)
            
            # End stream
            await self._end_stream({"reason": "unexpected_shutdown", "details": reason})
            
        except Exception as e:
            self._log(f"Error during unexpected shutdown: {e}")
    
    def is_healthy(self) -> bool:
        """Check if the observer is in a healthy state"""
        return (
            not self.is_shutdown and
            self.error_count < self.max_errors and
            self.current_memory_usage < self.max_memory_bytes
        )
    
    async def shutdown(self, reason: str = "Graceful shutdown requested"):
        """Gracefully shutdown the observer"""
        if self.is_shutdown:
            return
            
        self._log(f"Initiating graceful shutdown: {reason}")
        self.is_shutdown = True
        
        try:
            # End current message if active
            if self.current_message_id:
                await self._end_current_message()
            
            # Skip shutdown notification - connection is ending anyway
            
            # End stream
            await self._end_stream({"reason": "graceful_shutdown", "details": reason})
            
        except Exception as e:
            self._log(f"Error during graceful shutdown: {e}")
    
    async def _start_text_message(self, role: str = "assistant") -> str:
        """Start a new text message and return message ID"""
        if not self.current_message_id:
            self.current_message_id = str(uuid.uuid4())
            
            # Clear text deduplication tracking for new message
            self.processed_text_chunks.clear()
            # Reset run finished flag for new message
            self.run_finished = False
            
            event = TextMessageStartEvent(
                message_id=self.current_message_id,
                role=role,  # type: ignore
                timestamp=self._get_timestamp()
            )
            
            await self._send_agui_event(event)
            # Always log message start regardless of debug setting
            logger.info(f"[TEXT_MESSAGE] Started message: {self.current_message_id} (role={role})")
            self._total_chars = 0  # Reset character counter for new message
        
        return self.current_message_id
    
    async def _add_text_content(self, text: str):
        """Add content to current text message"""
        if not self.current_message_id:
            await self._start_text_message()
        
        event = TextMessageContentEvent(
            message_id=self.current_message_id,
            delta=text,
            timestamp=self._get_timestamp()
        )
        
        await self._send_agui_event(event)
        # Always log text content regardless of debug setting
        logger.info(f"[TEXT_CONTENT] Added delta: '{text}' (len={len(text)}, total_chars_so_far={getattr(self, '_total_chars', 0) + len(text)})")
        self._total_chars = getattr(self, '_total_chars', 0) + len(text)
    
    async def _end_current_message(self):
        """End current text message"""
        if self.current_message_id:
            event = TextMessageEndEvent(
                message_id=self.current_message_id,
                timestamp=self._get_timestamp()
            )
            
            await self._send_agui_event(event)
            # Always log message end regardless of debug setting
            logger.info(f"[TEXT_MESSAGE] Ended message: {self.current_message_id} (total_chars={getattr(self, '_total_chars', 0)})")
            self.current_message_id = None
            
            # Send any deferred custom events now that text message is complete
            await self._send_deferred_events()
    
    async def _handle_tool_call_start(self, tool_call_id: str, tool_name: str):
        """Handle tool call start"""
        self.current_tool_call_id = tool_call_id
        
        event = ToolCallStartEvent(
            tool_call_id=tool_call_id,
            tool_call_name=tool_name,
            parent_message_id=self.current_message_id,
            timestamp=self._get_timestamp()
        )
        
        await self._send_agui_event(event)
        self._log(f"Started tool call: {tool_call_id} ({tool_name})")
    
    async def _handle_tool_call_args(self, tool_call_id: str, args: Any):
        """Handle tool call arguments"""
        event = ToolCallArgsEvent(
            tool_call_id=tool_call_id,
            # AG-UI expects delta field, not args_delta
            delta=json.dumps(args) if not isinstance(args, str) else args,
            timestamp=self._get_timestamp()
        )
        await self._send_agui_event(event)
        self._log(f"Sent tool call args for: {tool_call_id}")

    async def _handle_tool_call_end(self, tool_call_id: str):
        """Handle the end of a tool call definition"""
        event = ToolCallEndEvent(
            tool_call_id=tool_call_id,
            timestamp=self._get_timestamp()
        )
        await self._send_agui_event(event)
        self._log(f"Ended tool call definition for: {tool_call_id}")
    
    async def _handle_tool_call_result(self, tool_call_id: str, result: Any):
        """Handle tool call result"""
        message_id = str(uuid.uuid4())
        content = result if isinstance(result, str) else json.dumps(result)
        
        event = ToolCallResultEvent(
            type=EventType.TOOL_CALL_RESULT,
            message_id=message_id,
            tool_call_id=tool_call_id,
            content=content,
            timestamp=self._get_timestamp()
        )
        
        await self._send_agui_event(event)
        self._log(f"Added tool call result: {tool_call_id}")
        
        # Clear tool call ID and send deferred events
        self.current_tool_call_id = None
        await self._send_deferred_events()
    
    async def _handle_user_transcription(self, frame, final: bool):
        """Handle user transcription frames"""
        event_data = {
            "text": frame.text,
            "final": final,
            "userId": getattr(frame, 'user_id', None),
            "language": getattr(frame, 'language', None)
        }
        await self._send_or_defer_custom_event("user_transcript", event_data)
    
    async def _send_custom_event(self, name: str, value: Any):
        """Send custom event"""
        event = CustomEvent(
            name=name,
            value=value,
            timestamp=self._get_timestamp()
        )
        
        await self._send_agui_event(event)
        self._log(f"Sent custom event: {name}")
    
    async def _send_or_defer_custom_event(self, name: str, value: Any):
        """Send custom event immediately or defer if text message or tool call is streaming"""
        event = CustomEvent(
            name=name,
            value=value,
            timestamp=self._get_timestamp()
        )
        
        if self.current_message_id or self.current_tool_call_id:
            # Defer the event until message/tool sequence is complete
            self.deferred_events.append(event)
            self._log(f"Deferred custom event: {name}")
        else:
            # Send immediately
            await self._send_agui_event(event)
            self._log(f"Sent custom event: {name}")
    
    async def _send_deferred_events(self):
        """Send all deferred custom events"""
        for event in self.deferred_events:
            await self._send_agui_event(event)
            self._log(f"Sent deferred custom event: {event.name}")
        
        # Clear deferred events
        self.deferred_events.clear()
    
    async def _send_agui_event(self, event: BaseEvent):
        """Send AG-UI event to SSE stream with memory monitoring"""
        try:
            # Guard against sending events after RUN_FINISHED
            if self.run_finished and event.type != EventType.RUN_FINISHED:
                self._log(f"[PROTOCOL_GUARD] Blocking event {event.type} - RUN_FINISHED already sent, stream closed")
                return
                
            # Encode event as SSE format
            encoded_event = self.encoder.encode(event)
            event_size = len(encoded_event.encode('utf-8'))
            
            # Check memory usage before adding event
            if self.current_memory_usage + event_size > self.max_memory_bytes:
                error_msg = f"AG-UI event queue memory limit exceeded: {self.current_memory_usage + event_size} bytes > {self.max_memory_bytes} bytes"
                self._log(error_msg)
                # Send error event to client and raise exception
                error_event = RunErrorEvent(
                    message="Event queue memory limit exceeded",
                    timestamp=self._get_timestamp()
                )
                # Try to send error event (if there's still room)
                error_encoded = self.encoder.encode(error_event)
                error_size = len(error_encoded.encode('utf-8'))
                if self.current_memory_usage + error_size <= self.max_memory_bytes:
                    await self.event_queue.put(error_encoded)
                    self.current_memory_usage += error_size
                raise MemoryError(error_msg)
            
            # Add to event queue
            await self.event_queue.put(encoded_event)
            self.current_memory_usage += event_size
            
            # Enhanced logging for event queuing
            if event.type == "TEXT_MESSAGE_CONTENT":
                content = getattr(event, 'content', {})
                text_content = content.get('text', '') if isinstance(content, dict) else str(content)
                self._log(f"[EVENT_QUEUE] Queued AG-UI event: {event.type} with text: '{text_content[:50]}...' ({event_size} bytes, total: {self.current_memory_usage} bytes)")
            else:
                self._log(f"[EVENT_QUEUE] Queued AG-UI event: {event.type} ({event_size} bytes, total: {self.current_memory_usage} bytes)")
        
        except MemoryError:
            # Re-raise memory errors to stop the pipeline
            raise
        except Exception as e:
            self._log(f"Failed to queue AG-UI event: {e}")
            # Don't raise other exceptions - keep pipeline running
    
    async def get_sse_stream(self) -> AsyncGenerator[str, None]:
        """Get SSE stream for web client consumption"""
        try:
            while not self.is_shutdown and (self.is_streaming or not self.event_queue.empty()):
                try:
                    # Wait for events with timeout for heartbeat
                    event_data = await asyncio.wait_for(self.event_queue.get(), timeout=30.0)
                    
                    # Log what's actually being sent via SSE
                    try:
                        import json
                        event_json = json.loads(event_data.replace("data: ", "").replace("\\n\\n", ""))
                        event_type = event_json.get("type", "unknown")
                        self._log(f"[SSE_STREAM] Actually sending event via SSE: {event_type}")
                        if event_type == "TEXT_MESSAGE_CONTENT":
                            content = event_json.get("content", {}).get("text", "")[:50]
                            self._log(f"[SSE_STREAM] Text content: '{content}...'")
                        else:
                            # Log full event for non-text events to debug CUSTOM event issue
                            self._log(f"[SSE_STREAM] Full event data: {event_data[:200]}...")
                    except Exception as e:
                        self._log(f"[SSE_STREAM] Sending event (unparseable): {event_data[:100]}... Error: {e}")
                    
                    # Update memory usage when event is consumed
                    event_size = len(event_data.encode('utf-8'))
                    self.current_memory_usage = max(0, self.current_memory_usage - event_size)
                    
                    yield event_data
                except asyncio.TimeoutError:
                    # Send heartbeat if no events for 30 seconds
                    if self.is_healthy():
                        yield "data: {\"type\":\"heartbeat\"}\n\n"
                    else:
                        # Send health warning with heartbeat
                        yield f"data: {{\"type\":\"heartbeat\",\"healthy\":false,\"error_count\":{self.error_count}}}\n\n"
                except asyncio.CancelledError:
                    self._log("SSE stream cancelled")
                    break
        except Exception as e:
            self._log(f"SSE stream error: {e}")
            yield f"data: {{\"type\":\"error\",\"message\":\"{str(e)}\"}}\\n\\n"
        finally:
            self._log("SSE stream ended")
    
    def _get_timestamp(self) -> int:
        """Get current timestamp in milliseconds"""
        return int(time.time() * 1000)
    
    def _log(self, message: str):
        """Debug logging"""
        if self.debug:
            logger.info(f"[AGUIObserver] {message}")
    
    async def cleanup(self):
        """Clean up observer resources - required by Pipecat observer interface"""
        try:
            await self.shutdown("Observer cleanup requested")
        except Exception as e:
            self._log(f"Error during cleanup: {e}")


# Example usage function
async def example_usage():
    """
    Example of how to use the AG-UI observer in a Pipecat application.
    """
    
    # Import your Pipecat components
    # from your_transport import transport
    # from your_stt import stt_service
    # from your_llm import llm_service
    # from your_tts import tts_service
    # from your_context import context_aggregator
    
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.task import PipelineTask, PipelineParams
    from pipecat.pipeline.runner import PipelineRunner
    from fastapi import FastAPI
    from fastapi.responses import StreamingResponse
    from ag_ui.core import RunAgentInput
    
    # Create AG-UI observer with memory limit
    agui_observer = AGUIObserver(debug=True, max_memory_mb=50)
    
    # Create pipeline
    pipeline = Pipeline([
        # transport.input(),
        # rtvi,                       # RTVI processor
        # stt_service,                # Speech-to-text
        # context_aggregator.user(),
        # llm_service,                # Language model
        # tts_service,                # Text-to-speech
        # transport.output(),
        # context_aggregator.assistant(),
    ])
    
    # Create task with AG-UI observer
    task = PipelineTask(
        pipeline,
        params=PipelineParams(allow_interruptions=True),
        observers=[agui_observer]
    )
    
    # Add AG-UI endpoint to your WebSocket server's FastAPI app
    app = FastAPI()
    
    @app.post("/sse")
    async def handle_agui_run(input_data: RunAgentInput):
        """Handle AG-UI run requests and return SSE stream"""
        
        # Inject user messages from AG-UI into pipeline
        for message in input_data.messages:
            if message.role == "user":
                text_frame = TextFrame(text=message.content)
                await task.queue_frame(text_frame)
        
        # Return SSE stream of AG-UI events
        return StreamingResponse(
            agui_observer.get_sse_stream(),
            media_type="text/event-stream"
        )
    
    # Start FastAPI server in background thread if needed
    # import uvicorn
    # import threading
    # server_thread = threading.Thread(
    #     target=lambda: uvicorn.run(app, host="0.0.0.0", port=3000),
    #     daemon=True
    # )
    # server_thread.start()
    
    # Run pipeline
    runner = PipelineRunner()
    await runner.run(task)


if __name__ == "__main__":
    # Run example
    asyncio.run(example_usage())