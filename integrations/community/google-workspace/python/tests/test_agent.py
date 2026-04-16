"""Tests for the Google Workspace agent's user_email extractor and config."""

from __future__ import annotations

import pytest
from ag_ui.core import Context, RunAgentInput

from ag_ui_google_workspace_agent.agent import (
    USER_EMAIL_CONTEXT_KEY,
    extract_user_email,
    workspace_adk_agent,
    workspace_agent,
)


def _make_input(contexts: list[Context]) -> RunAgentInput:
    return RunAgentInput(
        thread_id="t-1",
        run_id="r-1",
        state={},
        messages=[],
        tools=[],
        context=contexts,
        forwarded_props={},
    )


class TestExtractUserEmail:
    def test_returns_value_when_present(self):
        email = extract_user_email(
            _make_input([Context(description=USER_EMAIL_CONTEXT_KEY, value="alice@example.com")])
        )
        assert email == "alice@example.com"

    def test_trims_whitespace(self):
        email = extract_user_email(
            _make_input([Context(description=USER_EMAIL_CONTEXT_KEY, value="  bob@example.com  ")])
        )
        assert email == "bob@example.com"

    def test_raises_when_missing(self):
        with pytest.raises(ValueError, match="Missing required context entry"):
            extract_user_email(_make_input([]))

    def test_raises_when_other_context_entries_but_no_user_email(self):
        with pytest.raises(ValueError, match="Missing required context entry"):
            extract_user_email(
                _make_input(
                    [Context(description="Google Workspace host application", value="GMAIL")]
                )
            )

    def test_raises_when_empty_value(self):
        with pytest.raises(ValueError, match="is empty"):
            extract_user_email(
                _make_input([Context(description=USER_EMAIL_CONTEXT_KEY, value="")])
            )

    def test_raises_when_only_whitespace(self):
        with pytest.raises(ValueError, match="is empty"):
            extract_user_email(
                _make_input([Context(description=USER_EMAIL_CONTEXT_KEY, value="   ")])
            )

    def test_picks_up_entry_among_others(self):
        email = extract_user_email(
            _make_input(
                [
                    Context(description="Google Workspace host application", value="CALENDAR"),
                    Context(description="Event title", value="Standup"),
                    Context(description=USER_EMAIL_CONTEXT_KEY, value="carol@example.com"),
                ]
            )
        )
        assert email == "carol@example.com"


class TestWorkspaceAgentConfig:
    def test_app_name(self):
        assert workspace_adk_agent._static_app_name == "google_workspace"

    def test_user_id_extractor_is_set(self):
        assert workspace_adk_agent._user_id_extractor is extract_user_email
        assert workspace_adk_agent._static_user_id is None

    def test_uses_in_memory_memory_service(self):
        # use_in_memory_services=True wires up InMemoryMemoryService automatically
        assert workspace_adk_agent._memory_service is not None

    def test_per_turn_memory_flush_enabled(self):
        assert (
            workspace_adk_agent._session_manager.save_session_to_memory_per_turn is True
        )

    def test_preload_memory_tool_in_tools(self):
        tool_class_names = [type(t).__name__ for t in workspace_agent.tools]
        assert "PreloadMemoryTool" in tool_class_names

    def test_agui_toolset_in_tools(self):
        tool_class_names = [type(t).__name__ for t in workspace_agent.tools]
        assert "AGUIToolset" in tool_class_names
