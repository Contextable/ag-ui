"""Tests for the Tavily web search tool.

These mock out httpx so no real network call is made. We verify:
- the keyless header is always sent (matches Tavily's docs)
- the API key is only added when TAVILY_API_KEY is set, and goes in the body
- HTTP error responses are surfaced with Tavily's natural-language body
  rather than raised, so the agent can pass them to the user
- network errors are surfaced the same way
- max_results is clamped to [1, 10] before being sent
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from ag_ui_google_workspace_agent.web_search import (
    TAVILY_SEARCH_URL,
    tavily_search,
    tavily_search_tool,
)


def _mock_response(status_code: int = 200, json_body: dict | None = None) -> MagicMock:
    response = MagicMock(spec=httpx.Response)
    response.status_code = status_code
    response.json.return_value = json_body or {}
    response.text = str(json_body or "")
    if status_code >= 400:
        response.raise_for_status.side_effect = httpx.HTTPStatusError(
            f"HTTP {status_code}", request=MagicMock(), response=response
        )
    else:
        response.raise_for_status.return_value = None
    return response


class TestKeylessMode:
    def test_sends_keyless_header(self, monkeypatch):
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        with patch("ag_ui_google_workspace_agent.web_search.httpx.post") as mock_post:
            mock_post.return_value = _mock_response(
                json_body={"query": "hi", "answer": "", "results": []}
            )
            tavily_search("hi")

            assert mock_post.call_count == 1
            kwargs = mock_post.call_args.kwargs
            assert kwargs["headers"] == {"X-Tavily-Access-Mode": "keyless"}
            assert "api_key" not in kwargs["json"]
            assert kwargs["json"]["query"] == "hi"

    def test_target_url_is_search_endpoint(self, monkeypatch):
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        with patch("ag_ui_google_workspace_agent.web_search.httpx.post") as mock_post:
            mock_post.return_value = _mock_response(json_body={})
            tavily_search("hi")
            assert mock_post.call_args.args[0] == TAVILY_SEARCH_URL

    def test_returns_parsed_json_body(self, monkeypatch):
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        body = {
            "query": "weather Paris",
            "answer": "Sunny, 22°C.",
            "results": [
                {"title": "Paris weather", "url": "https://example.com", "content": "...", "score": 0.9}
            ],
        }
        with patch("ag_ui_google_workspace_agent.web_search.httpx.post") as mock_post:
            mock_post.return_value = _mock_response(json_body=body)
            result = tavily_search("weather Paris")
            assert result == body


class TestApiKeyMode:
    def test_includes_api_key_in_body_when_env_set(self, monkeypatch):
        monkeypatch.setenv("TAVILY_API_KEY", "tvly-test-key-123")
        with patch("ag_ui_google_workspace_agent.web_search.httpx.post") as mock_post:
            mock_post.return_value = _mock_response(json_body={})
            tavily_search("hi")
            payload = mock_post.call_args.kwargs["json"]
            assert payload["api_key"] == "tvly-test-key-123"

    def test_keyless_header_still_sent_with_api_key(self, monkeypatch):
        # Per Tavily docs, sending both is fine — API key takes precedence
        # but the keyless header doesn't have to be removed.
        monkeypatch.setenv("TAVILY_API_KEY", "tvly-test-key-123")
        with patch("ag_ui_google_workspace_agent.web_search.httpx.post") as mock_post:
            mock_post.return_value = _mock_response(json_body={})
            tavily_search("hi")
            headers = mock_post.call_args.kwargs["headers"]
            assert headers == {"X-Tavily-Access-Mode": "keyless"}


class TestMaxResultsClamping:
    @pytest.mark.parametrize(
        "requested,expected",
        [(1, 1), (5, 5), (10, 10), (0, 1), (-3, 1), (50, 10)],
    )
    def test_clamped_to_valid_range(self, monkeypatch, requested, expected):
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        with patch("ag_ui_google_workspace_agent.web_search.httpx.post") as mock_post:
            mock_post.return_value = _mock_response(json_body={})
            tavily_search("hi", max_results=requested)
            assert mock_post.call_args.kwargs["json"]["max_results"] == expected


class TestErrorSurfacing:
    def test_rate_limit_body_is_surfaced_not_raised(self, monkeypatch):
        # Tavily's keyless rate-limit response is a 4xx with a JSON body
        # containing natural-language guidance. We want the agent to see
        # that text so it can explain to the user, not a 500.
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        rate_limit_body = {
            "message": "Keyless search budget exhausted for this minute. "
                       "Try again in a few seconds or set TAVILY_API_KEY."
        }
        with patch("ag_ui_google_workspace_agent.web_search.httpx.post") as mock_post:
            mock_post.return_value = _mock_response(
                status_code=429, json_body=rate_limit_body
            )
            result = tavily_search("hi")
            assert "error" in result
            assert "429" in result["error"]
            assert result["details"] == rate_limit_body

    def test_non_json_error_response_falls_back_to_raw_text(self, monkeypatch):
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        bad_response = _mock_response(status_code=502)
        bad_response.json.side_effect = ValueError("not JSON")
        bad_response.text = "Bad Gateway"
        with patch("ag_ui_google_workspace_agent.web_search.httpx.post") as mock_post:
            mock_post.return_value = bad_response
            result = tavily_search("hi")
            assert "error" in result
            assert result["details"] == {"raw": "Bad Gateway"}

    def test_network_error_is_surfaced_not_raised(self, monkeypatch):
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        with patch("ag_ui_google_workspace_agent.web_search.httpx.post") as mock_post:
            mock_post.side_effect = httpx.ConnectTimeout("connection timeout")
            result = tavily_search("hi")
            assert "error" in result
            assert "network" in result["error"].lower()
            assert "ConnectTimeout" in result["details"]


class TestFunctionToolBinding:
    def test_tool_wraps_tavily_search_function(self):
        # Sanity check: the exported FunctionTool actually wraps our function.
        # ADK reads __name__ + __doc__ off the wrapped function to build the
        # tool schema sent to the LLM.
        assert tavily_search_tool.func is tavily_search
        assert "Search the live web" in tavily_search.__doc__
