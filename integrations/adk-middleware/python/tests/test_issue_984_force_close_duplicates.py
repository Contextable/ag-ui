#!/usr/bin/env python
"""Tests for GitHub issue #984: force_close_streaming_message() causing duplicated text.

This test file verifies the fix for the duplicate text issue when an ADK agent
uses multiple tools in one response. The issue was that force_close_streaming_message()
would reset streaming state without saving the already-streamed text for duplicate
detection, causing accumulated text from ADK to be re-sent to the UI.

The fix includes:
1. force_close_streaming_message() now saves _current_stream_text to _last_streamed_text
2. _translate_text_content() detects prefix overlap when starting a new message
3. Only the new (non-overlapping) portion of accumulated text is emitted
"""

import pytest
from unittest.mock import MagicMock

from ag_ui.core import (
    EventType,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
)
from ag_ui_adk.event_translator import EventTranslator


class TestForceCloseOverlapDetection:
    """Test suite for force_close overlap detection fix (GitHub #984)."""

    @pytest.fixture
    def translator(self):
        """Create a fresh EventTranslator instance."""
        return EventTranslator()

    @pytest.fixture
    def make_adk_event(self):
        """Factory for creating mock ADK events with text content."""
        def _make_event(text: str, partial: bool = True, turn_complete: bool = False, is_final: bool = False):
            event = MagicMock()
            event.author = "model"
            event.partial = partial
            event.turn_complete = turn_complete
            event.finish_reason = None

            # Set up is_final_response
            event.is_final_response = MagicMock(return_value=is_final)

            # Create content with text part
            mock_part = MagicMock()
            mock_part.text = text
            mock_part.thought = None  # Not a thought

            mock_content = MagicMock()
            mock_content.parts = [mock_part]
            event.content = mock_content

            # No function calls or responses
            event.get_function_calls = MagicMock(return_value=[])
            event.get_function_responses = MagicMock(return_value=[])
            event.long_running_tool_ids = None
            event.actions = None
            event.custom_data = None

            return event
        return _make_event

    @pytest.mark.asyncio
    async def test_force_close_saves_streamed_text_with_run_id(self, translator):
        """Test that force_close_streaming_message saves streamed text for overlap detection."""
        # Simulate streaming state
        translator._is_streaming = True
        translator._streaming_message_id = "msg-123"
        translator._current_stream_text = "Here are some videos"

        events = []
        async for event in translator.force_close_streaming_message(run_id="run-456"):
            events.append(event)

        # Should emit TEXT_MESSAGE_END
        assert len(events) == 1
        assert events[0].type == EventType.TEXT_MESSAGE_END
        assert events[0].message_id == "msg-123"

        # Should save streamed text for overlap detection
        assert translator._last_streamed_text == "Here are some videos"
        assert translator._last_streamed_run_id == "run-456"

        # Should reset streaming state
        assert translator._is_streaming is False
        assert translator._streaming_message_id is None
        assert translator._current_stream_text == ""

    @pytest.mark.asyncio
    async def test_force_close_without_run_id_still_saves_text(self, translator):
        """Test that force_close saves text even without run_id (backwards compatible)."""
        translator._is_streaming = True
        translator._streaming_message_id = "msg-123"
        translator._current_stream_text = "Some text"

        events = []
        async for event in translator.force_close_streaming_message():
            events.append(event)

        # Should save text but not update run_id
        assert translator._last_streamed_text == "Some text"
        # run_id stays unchanged (None by default)

    @pytest.mark.asyncio
    async def test_overlap_detection_trims_duplicate_prefix(self, translator, make_adk_event):
        """Test that accumulated text with overlapping prefix is trimmed correctly."""
        run_id = "run-123"
        thread_id = "thread-456"

        # Step 1: Simulate text streaming
        event1 = make_adk_event("Here are some videos", partial=True)
        events = []
        async for event in translator.translate(event1, thread_id, run_id):
            events.append(event)

        assert len(events) == 2  # START, CONTENT
        assert events[0].type == EventType.TEXT_MESSAGE_START
        assert events[1].type == EventType.TEXT_MESSAGE_CONTENT
        assert events[1].delta == "Here are some videos"

        # Step 2: Force close (simulating tool call interruption)
        close_events = []
        async for event in translator.force_close_streaming_message(run_id=run_id):
            close_events.append(event)

        assert len(close_events) == 1
        assert close_events[0].type == EventType.TEXT_MESSAGE_END

        # Verify state was saved
        assert translator._last_streamed_text == "Here are some videos"
        assert translator._last_streamed_run_id == run_id

        # Step 3: Accumulated text arrives (starts with previously streamed text)
        event2 = make_adk_event("Here are some videos that can help you with pruning roses!", partial=True)
        overlap_events = []
        async for event in translator.translate(event2, thread_id, run_id):
            overlap_events.append(event)

        # Should start new message with ONLY the new content (trimmed)
        assert len(overlap_events) == 2  # START, CONTENT
        assert overlap_events[0].type == EventType.TEXT_MESSAGE_START
        assert overlap_events[1].type == EventType.TEXT_MESSAGE_CONTENT
        # The delta should be ONLY the new portion, not the full accumulated text
        assert overlap_events[1].delta == " that can help you with pruning roses!"

    @pytest.mark.asyncio
    async def test_overlap_detection_skips_fully_duplicate_content(self, translator, make_adk_event):
        """Test that fully duplicate content is skipped entirely."""
        run_id = "run-123"
        thread_id = "thread-456"

        # Step 1: Stream some text
        event1 = make_adk_event("Hello world", partial=True)
        events1 = []
        async for event in translator.translate(event1, thread_id, run_id):
            events1.append(event)

        # Step 2: Force close
        await self._collect_events(translator.force_close_streaming_message(run_id=run_id))

        # Step 3: Same text arrives again
        event2 = make_adk_event("Hello world", partial=True)
        events2 = []
        async for event in translator.translate(event2, thread_id, run_id):
            events2.append(event)

        # Should skip entirely (no events)
        assert len(events2) == 0

    @pytest.mark.asyncio
    async def test_no_overlap_detection_for_different_run_id(self, translator, make_adk_event):
        """Test that overlap detection only applies to the same run."""
        thread_id = "thread-456"

        # Step 1: Stream some text in run 1
        event1 = make_adk_event("Hello world", partial=True)
        await self._collect_events(translator.translate(event1, thread_id, "run-1"))

        # Step 2: Force close with run-1
        await self._collect_events(translator.force_close_streaming_message(run_id="run-1"))

        # Step 3: Same text arrives in run 2 (different run)
        event2 = make_adk_event("Hello world prefix with more text", partial=True)
        events = []
        async for event in translator.translate(event2, thread_id, "run-2"):
            events.append(event)

        # Should NOT trim because run_id is different
        assert len(events) == 2  # START, CONTENT
        assert events[1].delta == "Hello world prefix with more text"

    @pytest.mark.asyncio
    async def test_overlap_detection_tracks_full_accumulated_text(self, translator, make_adk_event):
        """Test that overlap detection tracks the full accumulated text from ADK.

        In the real issue #984 scenario, ADK sends accumulated text where each response
        CONTAINS all previous content. For example:
        - "Here are " → "Here are some videos " → "Here are some videos that help!"

        This test verifies that we track the FULL accumulated text (not just the
        trimmed delta) so subsequent overlapping responses are correctly handled.
        """
        run_id = "run-123"
        thread_id = "thread-456"

        # Step 1: Stream and force close
        event1 = make_adk_event("First", partial=True)
        await self._collect_events(translator.translate(event1, thread_id, run_id))
        await self._collect_events(translator.force_close_streaming_message(run_id=run_id))

        # Step 2: Accumulated text arrives (contains "First")
        event2 = make_adk_event("First second", partial=True)
        events2 = []
        async for event in translator.translate(event2, thread_id, run_id):
            events2.append(event)

        # Overlap should be detected and trimmed
        assert events2[1].delta == " second"

        # Step 3: Force close again
        await self._collect_events(translator.force_close_streaming_message(run_id=run_id))

        # Step 4: Further accumulated text (contains "First second")
        # This simulates ADK's accumulating pattern where each response includes all previous text
        event3 = make_adk_event("First second third", partial=True)
        events3 = []
        async for event in translator.translate(event3, thread_id, run_id):
            events3.append(event)

        # Overlap is with "First second" (the full accumulated text we're tracking)
        # Only " third" should be emitted
        assert events3[1].delta == " third"

    @pytest.mark.asyncio
    async def test_branch_switch_emits_full_new_content(self, translator, make_adk_event):
        """Test that a branch switch (non-overlapping text) emits full content.

        When ADK sends text that doesn't start with the tracked accumulated text,
        it's treated as a new response branch. This can happen if the agent decides
        to respond differently after a tool call. In this case, the full text should
        be emitted since there's no overlap to trim.
        """
        run_id = "run-123"
        thread_id = "thread-456"

        # Step 1: Stream and force close
        event1 = make_adk_event("First path", partial=True)
        await self._collect_events(translator.translate(event1, thread_id, run_id))
        await self._collect_events(translator.force_close_streaming_message(run_id=run_id))

        # Step 2: Accumulated text on same branch
        event2 = make_adk_event("First path continued", partial=True)
        events2 = []
        async for event in translator.translate(event2, thread_id, run_id):
            events2.append(event)
        assert events2[1].delta == " continued"

        # Step 3: Force close again
        await self._collect_events(translator.force_close_streaming_message(run_id=run_id))

        # Step 4: Different branch (does NOT start with "First path continued")
        event3 = make_adk_event("Second path entirely", partial=True)
        events3 = []
        async for event in translator.translate(event3, thread_id, run_id):
            events3.append(event)

        # No overlap detected - full text is emitted
        assert events3[1].delta == "Second path entirely"

    @pytest.mark.asyncio
    async def test_no_overlap_for_unrelated_new_text(self, translator, make_adk_event):
        """Test that unrelated text is not affected by overlap detection."""
        run_id = "run-123"
        thread_id = "thread-456"

        # Step 1: Stream and force close
        event1 = make_adk_event("Topic A content", partial=True)
        await self._collect_events(translator.translate(event1, thread_id, run_id))
        await self._collect_events(translator.force_close_streaming_message(run_id=run_id))

        # Step 2: Completely different text arrives
        event2 = make_adk_event("Topic B is totally different", partial=True)
        events = []
        async for event in translator.translate(event2, thread_id, run_id):
            events.append(event)

        # Should emit full text (no overlap)
        assert len(events) == 2  # START, CONTENT
        assert events[1].delta == "Topic B is totally different"

    @pytest.mark.asyncio
    async def test_multiple_tools_scenario(self, translator, make_adk_event):
        """Test the scenario from issue #984: multiple tools in one response."""
        run_id = "run-123"
        thread_id = "thread-456"

        # Simulate: Text -> Tool 1 -> Text (accumulated) -> Tool 2 -> Text (accumulated)

        # Step 1: Initial text
        text1 = make_adk_event("Here are ", partial=True)
        events1 = []
        async for event in translator.translate(text1, thread_id, run_id):
            events1.append(event)

        # Step 2: Force close for Tool 1
        await self._collect_events(translator.force_close_streaming_message(run_id=run_id))

        # Step 3: Accumulated text after Tool 1
        text2 = make_adk_event("Here are some videos ", partial=True)
        events2 = []
        async for event in translator.translate(text2, thread_id, run_id):
            events2.append(event)

        # Should only emit the new portion
        assert events2[1].delta == "some videos "

        # Step 4: Force close for Tool 2
        await self._collect_events(translator.force_close_streaming_message(run_id=run_id))

        # Step 5: Final accumulated text after Tool 2
        text3 = make_adk_event("Here are some videos that can help you!", partial=True)
        events3 = []
        async for event in translator.translate(text3, thread_id, run_id):
            events3.append(event)

        # Should only emit the newest portion
        assert events3[1].delta == "that can help you!"

    async def _collect_events(self, async_gen):
        """Helper to collect all events from an async generator."""
        events = []
        async for event in async_gen:
            events.append(event)
        return events


class TestForceCloseBackwardsCompatibility:
    """Tests for backwards compatibility of force_close changes."""

    @pytest.fixture
    def translator(self):
        return EventTranslator()

    @pytest.mark.asyncio
    async def test_force_close_when_not_streaming(self, translator):
        """Test that force_close does nothing when not streaming."""
        # Not streaming
        translator._is_streaming = False
        translator._streaming_message_id = None

        events = []
        async for event in translator.force_close_streaming_message(run_id="run-123"):
            events.append(event)

        # Should emit nothing
        assert len(events) == 0
        # Should not modify last_streamed_text
        assert translator._last_streamed_text is None

    @pytest.mark.asyncio
    async def test_force_close_with_empty_stream_text(self, translator):
        """Test force_close with empty current stream text."""
        translator._is_streaming = True
        translator._streaming_message_id = "msg-123"
        translator._current_stream_text = ""  # Empty

        events = []
        async for event in translator.force_close_streaming_message(run_id="run-123"):
            events.append(event)

        # Should still emit END event
        assert len(events) == 1
        assert events[0].type == EventType.TEXT_MESSAGE_END

        # Should not save empty text
        assert translator._last_streamed_text is None or translator._last_streamed_text == ""

    @pytest.mark.asyncio
    async def test_reset_clears_overlap_tracking(self, translator):
        """Test that reset() clears overlap tracking state."""
        translator._last_streamed_text = "Some text"
        translator._last_streamed_run_id = "run-123"

        translator.reset()

        assert translator._last_streamed_text is None
        assert translator._last_streamed_run_id is None
