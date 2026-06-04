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

    def test_a2ui_toolset_in_tools(self):
        tool_class_names = [type(t).__name__ for t in workspace_agent.tools]
        assert "SendA2uiToClientToolset" in tool_class_names

    def test_a2ui_tool_name(self):
        from a2ui.adk.send_a2ui_to_client_toolset import SendA2uiToClientToolset

        toolsets = [t for t in workspace_agent.tools if isinstance(t, SendA2uiToClientToolset)]
        assert len(toolsets) == 1
        # The tool name the LLM will call must match what the TS add-on's
        # A2UIMiddleware listens for in `a2uiToolNames`.
        assert toolsets[0]._ui_tools[0].name == "send_a2ui_json_to_client"

    def test_a2ui_catalog_is_v0_9_basic(self):
        from ag_ui_google_workspace_agent.agent import _a2ui_catalog

        assert _a2ui_catalog.version == "0.9"
        assert _a2ui_catalog.name == "basic"

    def test_tavily_search_tool_in_tools(self):
        from google.adk.tools import FunctionTool

        from ag_ui_google_workspace_agent.web_search import tavily_search

        function_tools = [t for t in workspace_agent.tools if isinstance(t, FunctionTool)]
        assert any(t.func is tavily_search for t in function_tools), (
            "tavily_search FunctionTool should be wired into workspace_agent.tools"
        )


class TestWorkspaceInstructionA2uiGuidance:
    """The A2UI section of the instruction is load-bearing for tool use and for
    getting the v0.9 field names right. Guard against regressions that would
    tempt the LLM to emit wrong-shaped JSON (e.g. componentType) or to write
    JSON as text instead of calling the tool."""

    def _instruction(self) -> str:
        from ag_ui_google_workspace_agent.agent import WORKSPACE_INSTRUCTION

        return WORKSPACE_INSTRUCTION

    def test_forbids_writing_a2ui_json_as_text(self):
        text = self._instruction()
        # Must explicitly tell the model NEVER to emit raw JSON in prose
        assert "NEVER" in text
        assert "never" in text.lower()
        assert "send_a2ui_json_to_client" in text
        # And must call out the specific tool name as the required path
        assert "CALL `send_a2ui_json_to_client" in text

    def test_enumerates_correct_v0_9_field_names(self):
        text = self._instruction()
        # Must describe the correct field names so the model doesn't
        # hallucinate `componentType` / `componentId` / `type`.
        assert "`component`" in text
        assert "`id`" in text
        assert "Not** `componentType`" in text
        assert "Not** `componentId`" in text

    def test_worked_examples_use_correct_fields(self):
        text = self._instruction()
        # The examples embedded in the prompt must follow v0.9 exactly —
        # the LLM pattern-matches them verbatim. If we regress and use
        # `componentType` or `componentId` in an example, the agent will
        # emit that shape and the renderer will fall back to unsupported
        # placeholders.
        assert '"componentType"' not in text
        assert '"componentId"' not in text
        # And the correct fields should appear in the examples
        assert '"component":' in text
        assert '"id":' in text

    def test_mentions_required_message_structure(self):
        text = self._instruction()
        # Both createSurface and updateComponents need to be used together
        # on the first render
        assert "createSurface" in text
        assert "updateComponents" in text
        # And root must be a layout component
        assert '"id": "root"' in text or '"id":"root"' in text

    def test_describes_action_event_wrapper(self):
        text = self._instruction()
        # Button actions use { event: { name } } — a common pitfall is to
        # put name at the top level of action
        assert '"event"' in text or "event wrapper" in text or "action.event" in text

    def test_explains_card_single_child_rule(self):
        """Regression guard: the agent kept emitting
        `{"id":"c1","component":"Card","children":[...]}` because my prompt
        didn't explicitly forbid it. The instruction must now show the
        wrong shape AND the right pattern (wrap items in a Column/Row)."""
        text = self._instruction()
        # Must call out that Card takes `child`, not `children`
        assert "SINGLE `child`" in text or "single `child`" in text or "`child` (singular)" in text
        # Must show a WRONG example using `children` on a Card so the
        # model can pattern-match it as "don't do this"
        assert '"Card", "children"' in text or '"component": "Card", "children"' in text
        # Must show the RIGHT wrapping pattern (Card → Column/Row → items)
        # The worked example uses `c1-row` / `c1-body` style ids
        assert "Row" in text and "Column" in text

    def test_has_worked_example_for_multi_item_cards(self):
        """The 'list of cards with multiple items inside each' example must
        be present — it's the pattern the agent was failing on."""
        text = self._instruction()
        assert "MULTIPLE items inside" in text or "more than one thing inside" in text
