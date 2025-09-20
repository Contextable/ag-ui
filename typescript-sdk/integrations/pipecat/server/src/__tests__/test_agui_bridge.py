"""
Tests for AG-UI Bridge for Pipecat

This module tests the AGUIObserver class and its integration with Pipecat pipelines.
"""

import asyncio
import json
import logging
import pytest
from unittest.mock import Mock, AsyncMock, patch
from typing import List, Any

# Import the module under test
from src.agui_bridge import AGUIObserver

# Import actual AG-UI events
from ag_ui.core.events import (
    EventType,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    ToolCallStartEvent,
    ToolCallResultEvent,
    CustomEvent,
    RunStartedEvent,
    RunFinishedEvent,
    RunErrorEvent,
)
from ag_ui.encoder.encoder import EventEncoder

# Import actual Pipecat frame types for proper inheritance
from pipecat.frames.frames import (
    Frame, TextFrame, TranscriptionFrame, InterimTranscriptionFrame,
    FunctionCallInProgressFrame, FunctionCallResultFrame,
    LLMFullResponseStartFrame, LLMFullResponseEndFrame,
    UserStartedSpeakingFrame, UserStoppedSpeakingFrame,
    BotStartedSpeakingFrame, BotStoppedSpeakingFrame,
    StartFrame, EndFrame, CancelFrame, ErrorFrame,
    LLMMessagesFrame, SystemFrame
)


@pytest.fixture
def mock_frames():
    """Mock Pipecat frame classes that inherit from actual frame types"""
    frames = Mock()
    
    # Create mock frame classes that inherit from actual frame types for isinstance() checks
    def create_mock_frame_class(base_class):
        class MockFrame(base_class):
            def __init__(self, *args, **kwargs):
                # Don't call super().__init__ to avoid initialization issues
                for key, value in kwargs.items():
                    setattr(self, key, value)
        MockFrame.__name__ = f'Mock{base_class.__name__}'
        return MockFrame
    
    frames.Frame = create_mock_frame_class(Frame)
    frames.TextFrame = create_mock_frame_class(TextFrame)
    frames.TranscriptionFrame = create_mock_frame_class(TranscriptionFrame)
    frames.InterimTranscriptionFrame = create_mock_frame_class(InterimTranscriptionFrame)
    frames.FunctionCallInProgressFrame = create_mock_frame_class(FunctionCallInProgressFrame)
    frames.FunctionCallResultFrame = create_mock_frame_class(FunctionCallResultFrame)
    frames.LLMFullResponseStartFrame = create_mock_frame_class(LLMFullResponseStartFrame)
    frames.LLMFullResponseEndFrame = create_mock_frame_class(LLMFullResponseEndFrame)
    frames.UserStartedSpeakingFrame = create_mock_frame_class(UserStartedSpeakingFrame)
    frames.UserStoppedSpeakingFrame = create_mock_frame_class(UserStoppedSpeakingFrame)
    frames.BotStartedSpeakingFrame = create_mock_frame_class(BotStartedSpeakingFrame)
    frames.BotStoppedSpeakingFrame = create_mock_frame_class(BotStoppedSpeakingFrame)
    frames.StartFrame = create_mock_frame_class(StartFrame)
    frames.EndFrame = create_mock_frame_class(EndFrame)
    frames.CancelFrame = create_mock_frame_class(CancelFrame)
    frames.ErrorFrame = create_mock_frame_class(ErrorFrame)
    frames.LLMMessagesFrame = create_mock_frame_class(LLMMessagesFrame)
    frames.SystemFrame = create_mock_frame_class(SystemFrame)
    
    yield frames


class TestAGUIObserver:
    """Test cases for AGUIObserver class"""
    
    def test_init_default_params(self):
        """Test observer initialization with default parameters"""
        observer = AGUIObserver()
        
        assert observer.debug is False
        assert observer.max_memory_bytes == 100 * 1024 * 1024  # 100MB
        assert observer.current_memory_usage == 0
        assert observer.is_streaming is False
        assert observer.current_message_id is None
        assert observer.current_tool_call_id is None
        assert observer.run_id is not None
        assert observer.thread_id is not None
        assert isinstance(observer.encoder, EventEncoder)
    
    def test_init_custom_params(self):
        """Test observer initialization with custom parameters"""
        observer = AGUIObserver(debug=True, max_memory_mb=50)
        
        assert observer.debug is True
        assert observer.max_memory_bytes == 50 * 1024 * 1024  # 50MB
        assert observer.current_memory_usage == 0
    
    @pytest.mark.asyncio
    async def test_task_lifecycle(self):
        """Test task start and end lifecycle"""
        observer = AGUIObserver()
        mock_task = Mock()
        
        # Test task started
        await observer.on_task_started(mock_task)
        assert observer.is_streaming is True
        
        # Test task ended
        await observer.on_task_ended(mock_task)
        assert observer.is_streaming is False
    
    @pytest.mark.asyncio
    async def test_text_message_flow(self, mock_frames):
        """Test complete text message flow"""
        observer = AGUIObserver()
        mock_task = Mock()
        
        # Start streaming first
        await observer._start_stream()
        
        # Test message start
        start_frame = mock_frames.LLMFullResponseStartFrame()
        await observer.on_push_frame(Mock(frame=start_frame))
        
        assert observer.current_message_id is not None
        
        # Test message content
        text_frame = mock_frames.TextFrame()
        text_frame.text = "Hello, world!"
        await observer.on_push_frame(Mock(frame=text_frame))
        
        # Verify event was queued
        assert not observer.event_queue.empty()
        
        # Test message end
        end_frame = mock_frames.LLMFullResponseEndFrame()
        await observer.on_push_frame(Mock(frame=end_frame))
        
        assert observer.current_message_id is None
    
    @pytest.mark.asyncio
    async def test_tool_call_flow(self, mock_frames):
        """Test tool call start and result flow"""
        observer = AGUIObserver()
        mock_task = Mock()

        # Set up client tools so the tool call will trigger the client-side path
        observer.set_client_tools([Mock(name="test_function")])

        # Start streaming first
        await observer._start_stream()
        
        # Test tool call start
        tool_start_frame = mock_frames.FunctionCallsStartedFrame()
        tool_start_frame.function_calls = [Mock(tool_call_id="test_tool_123", function_name="test_function")]
        await observer.on_push_frame(Mock(frame=tool_start_frame))
        
        # Verify events were generated and queued
        assert not observer.event_queue.empty()
        
        # Test tool call result
        tool_result_frame = mock_frames.FunctionCallResultFrame()
        tool_result_frame.tool_call_id = "test_tool_123"
        tool_result_frame.result = {"status": "success", "data": "test result"}
        await observer.on_push_frame(Mock(frame=tool_result_frame))
        
        # Verify events were queued
        assert not observer.event_queue.empty()
    
    @pytest.mark.asyncio
    async def test_user_speaking_events(self, mock_frames):
        """Test user speaking start/stop events"""
        observer = AGUIObserver()
        mock_task = Mock()
        
        # Start streaming first
        await observer._start_stream()
        
        # Test user started speaking
        start_speaking_frame = mock_frames.UserStartedSpeakingFrame()
        await observer.on_push_frame(Mock(frame=start_speaking_frame))
        
        # Test user stopped speaking
        stop_speaking_frame = mock_frames.UserStoppedSpeakingFrame()
        await observer.on_push_frame(Mock(frame=stop_speaking_frame))
        
        # Verify events were queued
        assert not observer.event_queue.empty()
    
    @pytest.mark.asyncio
    async def test_transcription_events(self, mock_frames):
        """Test transcription frame handling"""
        observer = AGUIObserver()
        mock_task = Mock()
        
        # Start streaming first
        await observer._start_stream()
        
        # Test final transcription
        transcription_frame = mock_frames.TranscriptionFrame()
        transcription_frame.text = "Hello from user"
        await observer.on_push_frame(Mock(frame=transcription_frame))
        
        # Test interim transcription
        interim_frame = mock_frames.InterimTranscriptionFrame()
        interim_frame.text = "Hello from..."
        await observer.on_push_frame(Mock(frame=interim_frame))
        
        # Verify events were queued
        assert not observer.event_queue.empty()
    
    @pytest.mark.asyncio
    async def test_error_handling(self, mock_frames):
        """Test error frame handling"""
        observer = AGUIObserver()
        mock_task = Mock()
        
        # Start streaming first
        await observer._start_stream()
        
        # Test error frame
        error_frame = mock_frames.ErrorFrame()
        error_frame.error = Exception("Test error")
        await observer.on_push_frame(Mock(frame=error_frame))
        
        # Verify error event was queued
        assert not observer.event_queue.empty()
    
    @pytest.mark.asyncio
    async def test_memory_limit_exceeded(self):
        """Test memory limit protection"""
        # Create observer with very small memory limit
        observer = AGUIObserver(max_memory_mb=1)  # 1MB limit
        
        # Mock encoder to return large events
        large_event_data = "data: " + "x" * (2 * 1024 * 1024) + "\\n\\n"  # 2MB event
        with patch.object(observer.encoder, 'encode', return_value=large_event_data):
            # This should raise MemoryError
            with pytest.raises(MemoryError):
                await observer._send_agui_event(RunStartedEvent(
                    thread_id="test",
                    run_id="test"
                ))
    
    @pytest.mark.asyncio
    async def test_memory_usage_tracking(self):
        """Test memory usage is tracked correctly"""
        observer = AGUIObserver()
        
        # Send an event
        event = RunStartedEvent(thread_id="test", run_id="test")
        await observer._send_agui_event(event)
        
        # Check memory usage increased
        assert observer.current_memory_usage > 0
        initial_usage = observer.current_memory_usage
        
        # Simulate consuming the event
        async for event_data in observer.get_sse_stream():
            break  # Just get the first event
        
        # Memory usage should decrease
        assert observer.current_memory_usage < initial_usage
    
    @pytest.mark.asyncio
    async def test_sse_stream_generation(self):
        """Test SSE stream generation"""
        observer = AGUIObserver()
        
        # Start streaming and send an event
        await observer._start_stream()
        await observer._send_agui_event(TextMessageStartEvent(
            message_id="test_msg",
            role="assistant"
        ))
        await observer._end_stream()
        
        # Collect events from SSE stream
        events = []
        async for event in observer.get_sse_stream():
            events.append(event)
            if len(events) >= 3:  # Get start, message, and end events
                break
        
        assert len(events) >= 2
        # All events should be properly encoded SSE format
        for event in events:
            assert isinstance(event, str)
            assert "data: " in event
    
    @pytest.mark.asyncio
    async def test_sse_stream_heartbeat(self):
        """Test SSE stream heartbeat on timeout"""
        observer = AGUIObserver()
        
        # Start streaming but don't send events
        await observer._start_stream()
        
        # Mock asyncio.wait_for to raise TimeoutError
        with patch('asyncio.wait_for', side_effect=asyncio.TimeoutError):
            # Get one event from stream (should be heartbeat)
            async for event in observer.get_sse_stream():
                assert "heartbeat" in event
                break
    
    @pytest.mark.asyncio
    async def test_concurrent_events(self):
        """Test handling multiple concurrent events"""
        observer = AGUIObserver()
        
        # Don't start stream to avoid the extra RUN_STARTED event
        # Send multiple events concurrently
        tasks = []
        for i in range(10):
            event = TextMessageContentEvent(
                message_id=f"msg_{i}",
                delta=f"content {i}"
            )
            task = asyncio.create_task(observer._send_agui_event(event))
            tasks.append(task)
        
        await asyncio.gather(*tasks)
        
        # All events should be queued
        assert observer.event_queue.qsize() == 10
    
    def test_timestamp_generation(self):
        """Test timestamp generation"""
        observer = AGUIObserver()
        
        timestamp1 = observer._get_timestamp()
        timestamp2 = observer._get_timestamp()
        
        # Timestamps should be integers (milliseconds)
        assert isinstance(timestamp1, int)
        assert isinstance(timestamp2, int)
        # Second timestamp should be >= first
        assert timestamp2 >= timestamp1
    
    def test_logging_when_debug_enabled(self, caplog):
        """Test debug logging functionality"""
        with caplog.at_level(logging.INFO):
            observer = AGUIObserver(debug=True)
            observer._log("Test message")
            
            assert "Test message" in caplog.text
    
    def test_logging_when_debug_disabled(self, caplog):
        """Test logging is disabled when debug=False"""
        observer = AGUIObserver(debug=False)
        observer._log("Test message")
        
        assert "Test message" not in caplog.text


class TestIntegration:
    """Integration tests for AG-UI bridge with mocked Pipecat components"""
    
    @pytest.mark.asyncio
    async def test_full_conversation_flow(self, mock_frames):
        """Test a complete conversation flow"""
        observer = AGUIObserver(debug=True)
        mock_task = Mock()
        
        # Simulate conversation flow
        frames_sequence = [
            mock_frames.StartFrame(),  # Pipeline starts
            mock_frames.UserStartedSpeakingFrame(),  # User starts speaking
            mock_frames.TranscriptionFrame(text="Hello, how are you?"),  # User speech transcribed
            mock_frames.UserStoppedSpeakingFrame(),  # User stops speaking
            mock_frames.LLMFullResponseStartFrame(),  # LLM starts responding
            mock_frames.TextFrame(text="I'm doing well, "),  # LLM generates text
            mock_frames.TextFrame(text="thank you!"),  # More LLM text
            mock_frames.LLMFullResponseEndFrame(),  # LLM finishes
            mock_frames.BotStartedSpeakingFrame(),  # TTS starts
            mock_frames.BotStoppedSpeakingFrame(),  # TTS ends
            mock_frames.EndFrame(),  # Pipeline ends
        ]
        
        # Process all frames
        for frame in frames_sequence:
            await observer.on_push_frame(Mock(frame=frame))
        
        # Verify proper event sequence was generated
        assert observer.is_streaming is False  # Stream should be ended
        assert observer.current_message_id is None  # Message should be closed
        
        # Verify events were queued
        assert not observer.event_queue.empty()
    
    @pytest.mark.asyncio
    async def test_tool_usage_flow(self, mock_frames):
        """Test conversation with tool usage"""
        observer = AGUIObserver()
        mock_task = Mock()
        
        # Simulate tool usage flow - create frames correctly
        tool_start_frame = mock_frames.FunctionCallsStartedFrame()
        tool_start_frame.function_calls = [Mock(tool_call_id="weather_123", function_name="get_weather")]

        tool_result_frame = mock_frames.FunctionCallResultFrame()
        tool_result_frame.tool_call_id = "weather_123"
        tool_result_frame.result = {"temperature": 72, "conditions": "sunny"}

        frames_sequence = [
            mock_frames.StartFrame(),
            mock_frames.LLMFullResponseStartFrame(),
            tool_start_frame,
            tool_result_frame,
            mock_frames.TextFrame(text="The weather is 72°F and sunny!"),
            mock_frames.LLMFullResponseEndFrame(),
            mock_frames.EndFrame(),
        ]
        
        # Process all frames
        for frame in frames_sequence:
            await observer.on_push_frame(Mock(frame=frame))
        
        # Verify events were generated and queued
        assert not observer.event_queue.empty()
        # After tool call completes, current_tool_call_id should be None
        assert observer.current_tool_call_id is None


if __name__ == "__main__":
    # Run tests with pytest
    pytest.main([__file__, "-v"])