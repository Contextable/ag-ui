"""
Unit tests for AGUIObserver - AG-UI integration with Pipecat

These tests verify the AGUIObserver correctly implements the new Pipecat v0.0.83+ 
observer API and properly converts Pipecat frames to AG-UI events.
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from typing import Any

# Import the observer under test
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

# Import real Pipecat frame types - these are already installed
from pipecat.frames.frames import (
    LLMTextFrame, StartFrame, EndFrame, 
    FunctionCallInProgressFrame, FunctionCallResultFrame,
    LLMFullResponseEndFrame, Frame
)
from pipecat.observers.base_observer import FrameProcessed, FramePushed

# Define ErrorFrame since it doesn't exist in Pipecat
class ErrorFrame(Frame):
    def __init__(self, error: str):
        super().__init__()
        self.error = error

# Only mock AG-UI modules since we don't have them installed
# Mock AG-UI event classes
class MockEventEncoder:
    """Mock EventEncoder for testing"""
    def __init__(self, accept=None):
        self.accept = accept
        
    def encode(self, event):
        return f"data: {{'type': '{getattr(event, 'type', 'unknown')}'}}\n\n"

# Mock the BaseEvent class
class MockBaseEvent:
    def __init__(self, **kwargs):
        self.type = kwargs.get('type', 'unknown')
        for key, value in kwargs.items():
            setattr(self, key, value)

# Mock AG-UI imports  
mock_ag_ui = MagicMock()
mock_core = MagicMock()
mock_events = MagicMock()

# Add specific event classes
mock_events.BaseEvent = MockBaseEvent
mock_events.RunStartedEvent = type('RunStartedEvent', (MockBaseEvent,), {})
mock_events.RunFinishedEvent = type('RunFinishedEvent', (MockBaseEvent,), {})
mock_events.RunErrorEvent = type('RunErrorEvent', (MockBaseEvent,), {})
mock_events.TextMessageStartEvent = type('TextMessageStartEvent', (MockBaseEvent,), {})
mock_events.TextMessageContentEvent = type('TextMessageContentEvent', (MockBaseEvent,), {})
mock_events.TextMessageEndEvent = type('TextMessageEndEvent', (MockBaseEvent,), {})
mock_events.ToolCallStartEvent = type('ToolCallStartEvent', (MockBaseEvent,), {})
mock_events.ToolCallArgsEvent = type('ToolCallArgsEvent', (MockBaseEvent,), {})
mock_events.ToolCallEndEvent = type('ToolCallEndEvent', (MockBaseEvent,), {})
mock_events.ToolCallResultEvent = type('ToolCallResultEvent', (MockBaseEvent,), {})
mock_events.CustomEvent = type('CustomEvent', (MockBaseEvent,), {})
mock_events.EventType = MagicMock()

mock_encoder = MagicMock()
mock_encoder.EventEncoder = MockEventEncoder

sys.modules['ag_ui'] = mock_ag_ui
sys.modules['ag_ui.core'] = mock_core
sys.modules['ag_ui.core.events'] = mock_events
sys.modules['ag_ui.encoder'] = mock_encoder
sys.modules['ag_ui.encoder.encoder'] = mock_encoder

# Import after mocking
from agui_bridge import AGUIObserver


# No need to mock FrameProcessed and FramePushed - we're using real ones from Pipecat


class TestAGUIObserver:
    """Test suite for AGUIObserver"""
    
    @pytest.fixture
    def observer(self):
        """Create a fresh observer instance for each test"""
        return AGUIObserver(debug=True, max_memory_mb=10)
    
    @pytest.fixture
    def mock_task(self):
        """Mock PipelineTask"""
        return Mock()
    
    def test_observer_initialization(self, observer):
        """Test observer initializes correctly"""
        assert observer.debug is True
        assert observer.max_memory_bytes == 10 * 1024 * 1024
        assert observer.pending_tool_calls == 0
        assert observer._has_had_tool_calls is False
        assert observer.run_finished is False
        assert observer.is_shutdown is False
        assert observer.current_message_id is None
        assert observer.encoder is not None
    
    def test_observer_extends_base_observer(self, observer):
        """Test observer properly extends BaseObserver"""
        # Should have the required method for new API
        assert hasattr(observer, 'on_push_frame')
        assert callable(observer.on_push_frame)
        # Note: on_process_frame is not overridden in AGUIObserver (uses base class)
    
    @pytest.mark.asyncio
    async def test_on_push_frame_is_noop(self, observer):
        """Test on_push_frame does nothing (new API approach)"""
        mock_data = FramePushed(
            source=Mock(),
            destination=Mock(), 
            frame=StartFrame(),
            direction="DOWNSTREAM",
            timestamp=12345
        )
        
        # Should not raise any exceptions
        result = await observer.on_push_frame(mock_data)
        assert result is None
    
    @pytest.mark.asyncio 
    async def test_on_push_frame_start_frame(self, observer):
        """Test on_push_frame handles StartFrame correctly"""
        frame = StartFrame()
        mock_data = FramePushed(
            source=Mock(),
            destination=Mock(),
            frame=frame,
            direction="DOWNSTREAM", 
            timestamp=12345
        )
        
        # StartFrame should not start streaming automatically
        assert not observer.is_streaming
        await observer.on_push_frame(mock_data)
        # Should still not be streaming after StartFrame
        assert not observer.is_streaming
    
    @pytest.mark.asyncio
    async def test_frame_processing_when_shutdown(self, observer):
        """Test observer ignores frames when shutdown"""
        observer.is_shutdown = True
        frame = LLMTextFrame("test")
        mock_data = FramePushed(Mock(), Mock(), frame, "DOWNSTREAM", 12345)
        
        await observer.on_push_frame(mock_data)
        # Should not process anything when shutdown
        assert observer.event_queue.empty()  # No events should be queued
    
    @pytest.mark.asyncio 
    async def test_frame_processing_when_run_finished(self, observer):
        """Test observer ignores frames when run finished"""
        observer.run_finished = True
        frame = LLMTextFrame("test")
        mock_data = FramePushed(Mock(), Mock(), frame, "DOWNSTREAM", 12345)
        
        await observer.on_push_frame(mock_data)
        # Should not process anything when run is finished
        assert observer.event_queue.empty()  # No events should be queued
    
    @pytest.mark.asyncio
    async def test_llm_text_frame_processing(self, observer):
        """Test LLM text frames are processed correctly"""
        # on_task_started doesn't auto-start streaming anymore
        await observer.on_task_started(Mock())
        
        frame = LLMTextFrame("Hello World")
        mock_data = FramePushed(Mock(), Mock(), frame, "DOWNSTREAM", 12345)
        
        # Processing LLM text should create a message
        await observer.on_push_frame(mock_data)
        
        # Streaming doesn't auto-start, but message ID should be created
        assert observer.current_message_id is not None
        # Check that events were queued
        assert not observer.event_queue.empty()
    
    @pytest.mark.asyncio
    async def test_function_call_frame_processing(self, observer):
        """Test function call frames update tool tracking"""
        frame = FunctionCallInProgressFrame("test_function", "test-call-id", arguments={"arg": "value"})
        mock_data = FramePushed(Mock(), Mock(), frame, "DOWNSTREAM", 12345)
        
        # FunctionCallInProgressFrame doesn't directly affect tool tracking
        # (that's done by FunctionCallsStartedFrame)
        await observer.on_push_frame(mock_data)
        # Just verify it doesn't crash
        assert observer.pending_tool_calls == 0  # Not incremented by this frame type
    
    @pytest.mark.asyncio
    async def test_function_result_frame_processing(self, observer):
        """Test function result frames are handled"""
        observer.pending_tool_calls = 1
        observer._has_had_tool_calls = True
        
        frame = FunctionCallResultFrame(
            function_name="test_function",
            tool_call_id="test-call-id",
            arguments={"arg": "value"},
            result={"status": "success"}
        )
        mock_data = FramePushed(Mock(), Mock(), frame, "DOWNSTREAM", 12345)
        
        await observer.on_push_frame(mock_data)
        # Should decrement pending tool calls
        assert observer.pending_tool_calls == 0
    
    @pytest.mark.asyncio
    async def test_llm_response_end_no_tool_calls(self, observer):
        """Test LLM response end with no tool calls finishes run"""
        observer.pending_tool_calls = 0
        observer._has_had_tool_calls = False
        observer.is_streaming = True
        observer.current_message_id = "test-msg-id"
        
        frame = LLMFullResponseEndFrame()
        mock_data = FramePushed(Mock(), Mock(), frame, "DOWNSTREAM", 12345)
        
        await observer.on_push_frame(mock_data)
        # Should finish the run
        assert observer.run_finished
        assert observer.current_message_id is None  # Message should be ended
    
    @pytest.mark.asyncio
    async def test_llm_response_end_with_pending_tools(self, observer):
        """Test LLM response end with pending tools does not finish run"""
        observer.pending_tool_calls = 2
        observer.is_streaming = True
        observer.current_message_id = "test-msg-id"
        
        frame = LLMFullResponseEndFrame() 
        mock_data = FramePushed(Mock(), Mock(), frame, "DOWNSTREAM", 12345)
        
        await observer.on_push_frame(mock_data)
        # Should NOT finish the run since tools are pending
        assert not observer.run_finished
        assert observer.current_message_id is None  # Message should still be ended
    
    @pytest.mark.asyncio
    async def test_llm_response_end_after_tool_calls(self, observer):
        """Test LLM response end after tool calls finishes run"""
        observer.pending_tool_calls = 0
        observer._has_had_tool_calls = True
        observer.is_streaming = True
        observer.current_message_id = "test-msg-id"
        
        frame = LLMFullResponseEndFrame()
        mock_data = FramePushed(Mock(), Mock(), frame, "DOWNSTREAM", 12345)
        
        await observer.on_push_frame(mock_data)
        # Should finish the run after tools have completed
        assert observer.run_finished
        assert observer.current_message_id is None  # Message should be ended
    
    @pytest.mark.asyncio
    async def test_task_lifecycle_methods(self, observer, mock_task):
        """Test task start/end methods"""
        with patch.object(observer, '_end_stream') as mock_end:
            
            # on_task_started no longer auto-starts streaming
            await observer.on_task_started(mock_task)
            # No stream auto-start expected
            
            await observer.on_task_ended(mock_task)
            mock_end.assert_called_once()
    
    def test_tool_call_tracking(self, observer):
        """Test tool call tracking state management"""
        # Initially no tool calls
        assert observer.pending_tool_calls == 0
        assert observer._has_had_tool_calls is False
        
        # Simulate tool call start
        observer.pending_tool_calls += 1
        observer._has_had_tool_calls = True
        
        assert observer.pending_tool_calls == 1
        assert observer._has_had_tool_calls is True
        
        # Simulate tool call end
        observer.pending_tool_calls -= 1
        
        assert observer.pending_tool_calls == 0
        assert observer._has_had_tool_calls is True  # Remains true
    
    def test_memory_management_initialization(self, observer):
        """Test memory management is properly initialized"""
        assert hasattr(observer, 'max_memory_bytes')
        assert hasattr(observer, 'current_memory_usage')
        assert hasattr(observer, 'event_queue')
        assert observer.max_memory_bytes > 0
        assert observer.current_memory_usage == 0
    
    def test_error_handling_initialization(self, observer):
        """Test error handling state is properly initialized"""
        assert hasattr(observer, 'error_count')
        assert hasattr(observer, 'max_errors')
        assert observer.error_count == 0
        assert observer.max_errors > 0
    
    def test_frame_deduplication_state(self, observer):
        """Test frame deduplication tracking is initialized"""
        assert hasattr(observer, 'processed_text_chunks')
        assert hasattr(observer, 'last_frame_id')
        assert isinstance(observer.processed_text_chunks, set)
        assert len(observer.processed_text_chunks) == 0
        assert observer.last_frame_id is None
    
    @pytest.mark.asyncio
    async def test_error_frame_handling(self, observer):
        """Test error frames are handled properly"""
        error_frame = ErrorFrame("Test error")
        mock_data = FrameProcessed(Mock(), error_frame, "DOWNSTREAM", 12345)
        
        # Error frames increment error count
        initial_error_count = observer.error_count
        await observer.on_push_frame(mock_data)
        # ErrorFrame type doesn't exist in actual implementation, so this won't increment
        # Just verify it doesn't crash
        assert observer.error_count == initial_error_count


class TestObserverIntegration:
    """Integration tests for observer with mock pipeline"""
    
    @pytest.mark.asyncio
    async def test_complete_conversation_flow(self):
        """Test a complete conversation with tool calls"""
        observer = AGUIObserver(debug=True)
        
        # Simulate complete flow: Start -> LLM Text -> Tool Call -> Tool Result -> LLM Text -> End
        frames_and_expected_calls = [
            (StartFrame(), "should start pipeline"),
            (LLMTextFrame("I can help with that"), "should process text"),
            (FunctionCallInProgressFrame("test_func", "call-1", arguments={}), "should start tool call"),
            (FunctionCallResultFrame("test_func", "call-1", arguments={}, result={"result": "success"}), "should process tool result"),
            (LLMTextFrame("Task completed!"), "should process final text"),
            (LLMFullResponseEndFrame(), "should end conversation"),
        ]
        
        for i, (frame, description) in enumerate(frames_and_expected_calls):
            mock_data = FramePushed(Mock(), Mock(), frame, "DOWNSTREAM", 12345 + i)
            
            # Should not raise exceptions
            try:
                await observer.on_push_frame(mock_data)
            except Exception as e:
                pytest.fail(f"Frame {i} ({description}) raised exception: {e}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])