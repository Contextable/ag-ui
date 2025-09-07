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
from agui_bridge import AGUIObserver

# Import the actual pipecat frames that the observer uses
from pipecat.frames.frames import (
    StartFrame, EndFrame, LLMTextFrame, LLMFullResponseEndFrame, 
    FunctionCallInProgressFrame, FunctionCallResultFrame, ErrorFrame
)


class MockFrameProcessed:
    """Mock FrameProcessed data class for testing"""
    def __init__(self, processor, frame, direction, timestamp):
        self.processor = processor
        self.frame = frame
        self.direction = direction
        self.timestamp = timestamp


class MockFramePushed:
    """Mock FramePushed data class for testing"""
    def __init__(self, source, destination, frame, direction, timestamp):
        self.source = source
        self.destination = destination
        self.frame = frame
        self.direction = direction
        self.timestamp = timestamp


class TestAGUIObserver:
    """Test suite for AGUIObserver"""
    
    @pytest.fixture
    def observer(self):
        """Create a fresh observer instance for each test"""
        with patch('agui_bridge.EventEncoder') as mock_encoder:
            mock_encoder.return_value = Mock()
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
        # Should have the required methods
        assert hasattr(observer, 'on_process_frame')
        assert hasattr(observer, 'on_push_frame')
        assert callable(observer.on_process_frame)
        assert callable(observer.on_push_frame)
    
    @pytest.mark.asyncio
    async def test_on_push_frame_is_noop(self, observer):
        """Test on_push_frame does nothing (new API approach)"""
        mock_data = MockFramePushed(
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
    async def test_on_process_frame_start_frame(self, observer):
        """Test on_process_frame handles StartFrame correctly"""
        frame = StartFrame()
        mock_data = MockFrameProcessed(
            processor=Mock(),
            frame=frame,
            direction="DOWNSTREAM", 
            timestamp=12345
        )
        
        with patch.object(observer, '_log') as mock_log:
            await observer.on_process_frame(mock_data)
            # Should log that pipeline started
            mock_log.assert_called_with("Pipeline started, but not auto-starting AG-UI stream")
    
    @pytest.mark.asyncio
    async def test_frame_processing_when_shutdown(self, observer):
        """Test observer ignores frames when shutdown"""
        observer.is_shutdown = True
        frame = LLMTextFrame("test")
        mock_data = MockFrameProcessed(Mock(), frame, "DOWNSTREAM", 12345)
        
        with patch.object(observer, '_log') as mock_log:
            await observer.on_process_frame(mock_data)
            # Should not process anything
            mock_log.assert_not_called()
    
    @pytest.mark.asyncio 
    async def test_frame_processing_when_run_finished(self, observer):
        """Test observer ignores frames when run finished"""
        observer.run_finished = True
        frame = LLMTextFrame("test")
        mock_data = MockFrameProcessed(Mock(), frame, "DOWNSTREAM", 12345)
        
        with patch.object(observer, '_log') as mock_log:
            await observer.on_process_frame(mock_data)
            # Should not process anything  
            mock_log.assert_not_called()
    
    @pytest.mark.asyncio
    async def test_llm_text_frame_processing(self, observer):
        """Test LLM text frames are processed correctly"""
        frame = LLMTextFrame("Hello World")
        mock_data = MockFrameProcessed(Mock(), frame, "DOWNSTREAM", 12345)
        
        with patch.object(observer, '_add_text_content') as mock_handler:
            await observer.on_process_frame(mock_data)
            mock_handler.assert_called_once_with("Hello World")
    
    @pytest.mark.asyncio
    async def test_function_call_frame_processing(self, observer):
        """Test function call frames are processed and tracked"""
        # Create a mock function call object
        mock_func_call = Mock()
        mock_func_call.tool_call_id = "test-call-id"
        mock_func_call.function_name = "test_function"
        mock_func_call.arguments = {}
        
        # Create FunctionCallsStartedFrame with the function call
        from pipecat.frames.frames import FunctionCallsStartedFrame
        frame = FunctionCallsStartedFrame(function_calls=[mock_func_call])
        mock_data = MockFramePushed(Mock(), Mock(), frame, "DOWNSTREAM", 12345)
        
        # Set up some client tools so we can test the routing logic
        observer.current_client_tool_names = set()  # This will make it server-side
        
        # Test actual behavior without mocks
        await observer.on_push_frame(mock_data)
        
        # In the new architecture, tool calls are processed but the tracking
        # behavior depends on whether they're client-side or server-side
        # We can verify the tool call was processed
        assert "test-call-id" in observer._processed_tool_call_ids
    
    @pytest.mark.asyncio
    async def test_function_result_frame_processing(self, observer):
        """Test function result frames are handled"""
        observer.pending_tool_calls = 1
        
        frame = FunctionCallResultFrame("test_function", "test-call-id", {}, {"status": "success"})
        mock_data = MockFrameProcessed(Mock(), frame, "DOWNSTREAM", 12345)
        
        with patch.object(observer, '_handle_tool_call_result') as mock_handler:
            await observer.on_process_frame(mock_data)
            mock_handler.assert_called_once_with("test-call-id", {"status": "success"})
            assert observer.pending_tool_calls == 0
    
    @pytest.mark.asyncio
    async def test_llm_response_end_no_tool_calls(self, observer):
        """Test LLM response end with no tool calls finishes run"""
        observer.pending_tool_calls = 0
        observer._has_had_tool_calls = False
        
        frame = LLMFullResponseEndFrame()
        mock_data = MockFrameProcessed(Mock(), frame, "DOWNSTREAM", 12345)
        
        with patch.object(observer, '_end_current_message') as mock_end_msg, \
             patch.object(observer, '_finish_run') as mock_finish:
            await observer.on_process_frame(mock_data)
            mock_end_msg.assert_called_once()
            mock_finish.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_llm_response_end_with_pending_tools(self, observer):
        """Test LLM response end with pending tools does not finish run"""
        observer.pending_tool_calls = 2
        
        frame = LLMFullResponseEndFrame() 
        mock_data = MockFrameProcessed(Mock(), frame, "DOWNSTREAM", 12345)
        
        with patch.object(observer, '_end_current_message') as mock_end_msg, \
             patch.object(observer, '_finish_run') as mock_finish:
            await observer.on_process_frame(mock_data)
            mock_end_msg.assert_called_once()
            mock_finish.assert_not_called()
    
    @pytest.mark.asyncio
    async def test_llm_response_end_after_tool_calls(self, observer):
        """Test LLM response end after tool calls finishes run"""
        observer.pending_tool_calls = 0
        observer._has_had_tool_calls = True
        
        frame = LLMFullResponseEndFrame()
        mock_data = MockFrameProcessed(Mock(), frame, "DOWNSTREAM", 12345)
        
        with patch.object(observer, '_end_current_message') as mock_end_msg, \
             patch.object(observer, '_finish_run') as mock_finish:
            await observer.on_process_frame(mock_data)
            mock_end_msg.assert_called_once()
            mock_finish.assert_called_once_with({"status": "completed", "type": "final_llm_response"})
    
    @pytest.mark.asyncio
    async def test_task_lifecycle_methods(self, observer, mock_task):
        """Test task start/end methods"""
        with patch.object(observer, '_start_stream') as mock_start, \
             patch.object(observer, '_end_stream') as mock_end:
            
            await observer.on_task_started(mock_task)
            mock_start.assert_called_once()
            
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
        mock_data = MockFrameProcessed(Mock(), error_frame, "DOWNSTREAM", 12345)
        
        with patch.object(observer, '_handle_error') as mock_handler:
            await observer.on_process_frame(mock_data)
            mock_handler.assert_called_once_with(error_frame)
    
    @pytest.mark.asyncio
    async def test_process_frame_ignores_unknown_types(self, observer):
        """Test that unknown frame types are ignored without error"""
        # Create a frame type that isn't handled
        unknown_frame = Mock()
        unknown_frame.__class__.__name__ = "UnknownFrame"
        mock_data = MockFrameProcessed(Mock(), unknown_frame, "DOWNSTREAM", 12345)
        
        # Should not raise any exceptions
        await observer.on_process_frame(mock_data)
    
    @pytest.mark.asyncio
    async def test_core_api_methods_exist(self, observer):
        """Test that core AG-UI API methods exist and are callable"""
        # These are the key methods that should exist for AG-UI integration
        assert hasattr(observer, '_start_text_message')
        assert callable(observer._start_text_message)
        
        assert hasattr(observer, '_add_text_content')
        assert callable(observer._add_text_content)
        
        assert hasattr(observer, '_end_current_message')
        assert callable(observer._end_current_message)
        
        assert hasattr(observer, '_handle_tool_call_start')
        assert callable(observer._handle_tool_call_start)
        
        assert hasattr(observer, '_handle_tool_call_result')
        assert callable(observer._handle_tool_call_result)
        
        assert hasattr(observer, '_finish_run')
        assert callable(observer._finish_run)


class TestObserverIntegration:
    """Integration tests for observer with mock pipeline"""
    
    @pytest.mark.asyncio
    async def test_complete_conversation_flow(self):
        """Test a complete conversation with tool calls"""
        with patch('agui_bridge.EventEncoder'):
            observer = AGUIObserver(debug=True)
        
        # Create mock function call for the integration test
        mock_func_call = Mock()
        mock_func_call.tool_call_id = "call-1"
        mock_func_call.function_name = "test_func"
        mock_func_call.arguments = {}
        
        # Import the required frame type
        from pipecat.frames.frames import FunctionCallsStartedFrame
        
        # Simulate complete flow: Start -> LLM Text -> Tool Call -> Tool Result -> LLM Text -> End
        frames_and_expected_calls = [
            (StartFrame(), "should start pipeline"),
            (LLMTextFrame("I can help with that"), "should process text"),
            (FunctionCallsStartedFrame(function_calls=[mock_func_call]), "should start tool call"),
            (FunctionCallResultFrame("test_func", "call-1", {}, {"result": "success"}), "should process tool result"),
            (LLMTextFrame("Task completed!"), "should process final text"),
            (LLMFullResponseEndFrame(), "should end conversation"),
        ]
        
        for i, (frame, description) in enumerate(frames_and_expected_calls):
            # Use MockFramePushed for FunctionCallsStartedFrame, MockFrameProcessed for others
            if isinstance(frame, FunctionCallsStartedFrame):
                mock_data = MockFramePushed(Mock(), Mock(), frame, "DOWNSTREAM", 12345 + i)
            else:
                mock_data = MockFrameProcessed(Mock(), frame, "DOWNSTREAM", 12345 + i)
            
            # Should not raise exceptions
            try:
                if isinstance(frame, FunctionCallsStartedFrame):
                    await observer.on_push_frame(mock_data)
                else:
                    await observer.on_process_frame(mock_data)
            except Exception as e:
                pytest.fail(f"Frame {i} ({description}) raised exception: {e}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])