"""Utilities for bridging AG-UI payloads into a Pipecat pipeline.

This module hosts the logic that translates AG-UI tool definitions and
RunAgentInput payloads into Pipecat frames, keeping the Pipecat agent class
focused purely on pipeline behaviour.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List

from agui_bridge import AGUIObserver
from pipecat.adapters.schemas.tools_schema import FunctionSchema, ToolsSchema
from pipecat.frames.frames import (
    FunctionCallResultFrame,
    LLMSetToolsFrame,
    LLMMessagesAppendFrame,
)

logger = logging.getLogger(__name__)


class AGUIRunProcessor:
    """Translate AG-UI input payloads into Pipecat frames."""

    def __init__(self, observer: AGUIObserver, debounce_seconds: float = 2.0):
        self._observer = observer
        self._state = observer.state
        self._debounce_seconds = debounce_seconds
        self._last_empty_trigger_time = 0.0

    # ------------------------------------------------------------------
    # Tool conversion / registration
    # ------------------------------------------------------------------
    def convert_agui_tools_to_pipecat(self, agui_tools: List[Any]) -> ToolsSchema:
        """Convert AG-UI tool definitions into Pipecat's ToolsSchema."""
        pipecat_functions: List[FunctionSchema] = []

        for tool in agui_tools:
            parameters = tool.parameters
            properties = parameters.get("properties", {})
            required = parameters.get("required", [])

            function_schema = FunctionSchema(
                name=tool.name,
                description=tool.description,
                properties=properties,
                required=required,
            )
            pipecat_functions.append(function_schema)

            logger.info("Converted tool '%s' to Pipecat format", tool.name)
            logger.info("Tool description: '%s'", tool.description)

        return ToolsSchema(standard_tools=pipecat_functions)

    async def register_tool_handlers(self, agui_tools: List[Any], llm_service: Any) -> None:
        """Register tool handlers with the LLM service."""
        from pipecat.services.llm_service import FunctionCallParams

        for tool in agui_tools:
            if tool.name in self._state.current_client_tool_names:

                async def client_tool_handler(params: FunctionCallParams, *, tool_name=tool.name):
                    logger.info("Acknowledged client-side tool call: '%s'", params.function_name)
                    return {
                        "status": "success",
                        "message": f"Client-side tool '{tool_name}' acknowledged.",
                    }

                llm_service.register_function(tool.name, client_tool_handler)
                logger.info("Registered placeholder handler for client-side tool: '%s'", tool.name)
            else:

                async def tool_handler(params: FunctionCallParams, *, tool_name=tool.name):
                    logger.info(
                        "Tool '%s' called with args: %s", params.function_name, params.arguments
                    )
                    logger.info("Tool call ID: %s", params.tool_call_id)

                    result = {
                        "status": "success",
                        "message": f"Tool '{tool_name}' executed with args: {params.arguments}",
                        "result": "Tool execution placeholder - integrate with AG-UI tool system",
                    }

                    logger.info("Tool '%s' completed with result: %s", tool_name, result)

                    if params.result_callback:
                        await params.result_callback(result)

                    return result

                llm_service.register_function(tool.name, tool_handler)
                logger.info("Registered handler for server-side tool '%s'", tool.name)

    # ------------------------------------------------------------------
    # Run processing
    # ------------------------------------------------------------------
    async def process_agui_input(self, input_data: Any, services: Dict[str, Any], task: Any) -> None:
        """Queue Pipecat frames corresponding to an AG-UI RunAgentInput."""
        frames_to_queue: List[Any] = []

        if getattr(input_data, "tools", None):
            logger.info("Processing %s tools from AG-UI input", len(input_data.tools))

            tools_schema = self.convert_agui_tools_to_pipecat(input_data.tools)
            tools_frame = LLMSetToolsFrame(tools=tools_schema)
            frames_to_queue.append(tools_frame)

            self._state.set_client_tools(input_data.tools)
            await self.register_tool_handlers(input_data.tools, services["llm"])
            logger.info("Tool handlers registered and definitions sent to LLM.")

        newest_user_message = None
        new_tool_results: List[Any] = []

        for message in reversed(input_data.messages):
            message_id = getattr(message, "id", None) or getattr(message, "message_id", None)
            tool_call_id = getattr(message, "tool_call_id", None)

            if (
                message_id
                and message_id in self._state.processed_message_ids
                or tool_call_id
                and tool_call_id in self._state.processed_tool_result_ids
            ):
                logger.info("Found known message/tool_result ID. Stopping history scan.")
                break

            if message.role == "user" and not newest_user_message:
                newest_user_message = message
            elif message.role == "developer":
                await self._handle_developer_message(message, frames_to_queue)
            elif message.role == "tool":
                new_tool_results.append(message)

        if new_tool_results:
            await self._append_tool_results(new_tool_results, frames_to_queue)

        if newest_user_message:
            await self._append_user_message(newest_user_message, frames_to_queue)

        if frames_to_queue:
            await task.queue_frames(frames_to_queue)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    async def _handle_developer_message(self, message: Any, frames_to_queue: List[Any]) -> None:
        content = getattr(message, "content", "")
        if content and content.strip():
            if message.id in self._state.processed_message_ids:
                logger.info("[TRIGGER] Developer message already processed, skipping: '%s'", content)
                return

            from pipecat.frames.frames import LLMMessagesAppendFrame

            system_message_frame = LLMMessagesAppendFrame(
                messages=[{"role": "system", "content": content}],
                run_llm=True,
            )
            frames_to_queue.append(system_message_frame)
            self._state.processed_message_ids.add(message.id)
            logger.info(
                "[TRIGGER] Developer message converted to system instruction with LLM trigger: '%s'",
                content,
            )
        else:
            current_time = time.time()
            elapsed = current_time - self._last_empty_trigger_time
            if elapsed >= self._debounce_seconds:
                self._last_empty_trigger_time = current_time
                logger.info("[TRIGGER] Empty developer message received as run trigger (debounced)")
            else:
                logger.info(
                    "[TRIGGER] Empty developer message ignored (%.1fs < %.1fs)",
                    elapsed,
                    self._debounce_seconds,
                )

    async def _append_tool_results(self, tool_results: List[Any], frames_to_queue: List[Any]) -> None:
        for tool_result in reversed(tool_results):
            tool_call_id = getattr(tool_result, "tool_call_id", None)
            metadata = self._state.tool_call_metadata.get(tool_call_id)
            if not metadata:
                logger.error("No metadata found for new tool_call_id: %s", tool_call_id)
                continue

            result_frame = FunctionCallResultFrame(
                function_name=metadata["function_name"],
                tool_call_id=tool_call_id,
                arguments=metadata["arguments"],
                result=tool_result.content,
            )
            frames_to_queue.append(result_frame)
            self._state.processed_tool_result_ids.add(tool_call_id)
            logger.info(
                "Processed new tool result for %s with ID %s",
                metadata["function_name"],
                tool_call_id,
            )

    async def _append_user_message(self, message: Any, frames_to_queue: List[Any]) -> None:
        message_id = getattr(message, "id", None) or getattr(message, "message_id", None)
        logger.info("Injecting newest user message: %s", message.content)

        if message_id:
            self._state.processed_message_ids.add(message_id)
            logger.info("Tracked message ID: %s", message_id)

        from pipecat.frames.frames import LLMMessagesAppendFrame

        messages_frame = LLMMessagesAppendFrame(
            messages=[{"role": "user", "content": message.content}],
            run_llm=True,
        )
        frames_to_queue.append(messages_frame)
