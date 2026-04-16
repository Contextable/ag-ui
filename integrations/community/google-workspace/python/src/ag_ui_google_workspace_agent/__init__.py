"""AG-UI Google Workspace agent — ADK-backed assistant for Gmail/Calendar/Docs/Chat."""

from .agent import (
    USER_EMAIL_CONTEXT_KEY,
    extract_user_email,
    workspace_adk_agent,
    workspace_agent,
)

__all__ = [
    "USER_EMAIL_CONTEXT_KEY",
    "extract_user_email",
    "workspace_adk_agent",
    "workspace_agent",
]
