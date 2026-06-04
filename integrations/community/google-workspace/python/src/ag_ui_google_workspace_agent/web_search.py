"""Tavily web search tool for the workspace agent.

Wraps Tavily's ``/search`` endpoint as a `FunctionTool` the LLM can call.
Defaults to **keyless mode** — no API key required, just the
``X-Tavily-Access-Mode: keyless`` header — per
https://docs.tavily.com/documentation/keyless.

If ``TAVILY_API_KEY`` is set in the environment, the key is included in the
request body too. Per Tavily's docs, when both keyless and API key are
present the API key wins and the request uses your account's limits rather
than the shared keyless budget. So lifting rate caps is a pure ops change —
set the env var; no code update.

Tavily rate-limit responses in keyless mode arrive as 4xx with a JSON body
containing natural-language guidance. We surface that body to the agent
instead of swallowing it; the model can then explain to the user (e.g.
"the free search budget is exhausted, try again in a few minutes") rather
than silently looking like it forgot how to search.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from google.adk.tools import FunctionTool


TAVILY_SEARCH_URL = "https://api.tavily.com/search"
DEFAULT_TIMEOUT_SECONDS = 15.0
MAX_RESULTS_CAP = 10


def tavily_search(query: str, max_results: int = 5) -> dict[str, Any]:
    """Search the live web for current information.

    Use this when the user asks about something outside your training data:
    current events, recent news, "what's the latest on X", official docs,
    factual lookups with citations, prices/availability, weather, sports
    scores, etc.

    Do NOT use this for content already in the user's email / calendar /
    documents — those have dedicated tools (``read_current_email``,
    ``search_inbox``, ``read_document``, ``get_upcoming_events``, etc.).
    Pulling the same data through web search would be slower, leak
    nothing meaningful to Tavily, and miss private context.

    Args:
        query: The search query. Be specific. "OpenAI DevDay 2026 announcements"
            is better than "OpenAI news". Include dates, locations, or other
            qualifiers when they matter.
        max_results: Number of results to return. Default 5. Range 1-10. Use
            3 for quick lookups, 10 for research questions where you'll need
            to synthesize from multiple sources.

    Returns:
        A dict with Tavily's standard search response shape: ``query``
        (echo), ``answer`` (Tavily's synthesized one-line answer, may be
        empty), ``results`` (list of ``{title, url, content, score}``).
        On HTTP errors, returns ``{"error": "...", "details": ...}`` — the
        ``details`` field carries Tavily's natural-language rate-limit
        guidance when applicable; surface it verbatim to the user rather
        than retrying.
    """
    headers = {"X-Tavily-Access-Mode": "keyless"}
    payload: dict[str, Any] = {
        "query": query,
        "max_results": max(1, min(max_results, MAX_RESULTS_CAP)),
    }

    api_key = os.getenv("TAVILY_API_KEY")
    if api_key:
        payload["api_key"] = api_key

    try:
        response = httpx.post(
            TAVILY_SEARCH_URL,
            headers=headers,
            json=payload,
            timeout=DEFAULT_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as exc:
        try:
            body = exc.response.json()
        except ValueError:
            body = {"raw": exc.response.text[:500]}
        return {
            "error": f"Tavily search failed (HTTP {exc.response.status_code})",
            "details": body,
        }
    except httpx.RequestError as exc:
        return {
            "error": "Tavily search failed (network error)",
            "details": f"{type(exc).__name__}: {str(exc)[:200]}",
        }


tavily_search_tool = FunctionTool(func=tavily_search)
"""ADK FunctionTool wrapping `tavily_search` for the LlmAgent."""
