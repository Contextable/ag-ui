"""Agentic Chat feature."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from pydantic_ai import Agent
from pydantic_ai.ag_ui import StateDeps


class AgenticChatState(BaseModel):
    """Server-side state for the agentic chat demo."""

    background: str | None = None


agent = Agent('openai:gpt-4o-mini', deps_type=StateDeps[AgenticChatState])
app = agent.to_ag_ui(deps=StateDeps(AgenticChatState()))


@agent.tool_plain
async def current_time(timezone: str = 'UTC') -> str:
    """Get the current time in ISO format.

    Args:
        timezone: The timezone to use.

    Returns:
        The current time in ISO format string.
    """
    tz: ZoneInfo = ZoneInfo(timezone)
    return datetime.now(tz=tz).isoformat()
