# Changelog

All notable changes to `ag-ui-google-workspace-agent` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Web search via Tavily** (`tavily_search` FunctionTool, [src/ag_ui_google_workspace_agent/web_search.py](integrations/community/google-workspace/python/src/ag_ui_google_workspace_agent/web_search.py)). Default mode is **keyless** — POSTs to `https://api.tavily.com/search` with the `X-Tavily-Access-Mode: keyless` header per [Tavily's keyless docs](https://docs.tavily.com/documentation/keyless), no API key required. If `TAVILY_API_KEY` is set, the key is included in the request body too; Tavily prefers the key over keyless when both are present, so callers can lift rate limits without code changes. Rate-limit responses (4xx with a natural-language JSON body) are surfaced to the agent rather than raised, so the LLM can explain to the user instead of failing silently. Available on every Workspace surface — Gmail/Calendar/Docs/Chat — for any question outside the user's private workspace content. The `WORKSPACE_INSTRUCTION` documents when to prefer it vs. the host-app read tools. Adds `httpx>=0.27.0` as a direct dep (was already transitive). 15 new tests covering header shape, API-key precedence, max_results clamping, error surfacing, and tool wiring.

### Changed

- **Model is now configurable via `WORKSPACE_MODEL` env var** and the default switched from `gemini-3.5-flash` to **`gemini-2.5-pro`**. Picking a model for this agent is a JSON-precision problem, not a chat quality one — the agent has to emit strict A2UI v0.9 JSON in tool-call arguments. 3.5-flash was observed to malform A2UI JSON in practice; 2.5-pro is the GA workhorse for structured output and is the recommended default until 3.5-pro lands beyond limited Vertex preview. Set `WORKSPACE_MODEL=gemini-3.5-flash` (or any model your AI Studio key has access to) to override. The historical Flash bug notes live in [agent.py](integrations/community/google-workspace/python/src/ag_ui_google_workspace_agent/agent.py) as a comment block above `DEFAULT_WORKSPACE_MODEL`.

- **Model upgraded from `gemini-2.0-flash` to `gemini-3.5-flash`** (released 2026-05-19 at Google I/O 2026). Same Generative Language API, no Cloud Console changes required for callers using `GOOGLE_API_KEY`. Skipped 2.5-flash because of a known SSE streaming aggregator bug that silently dropped tool calls ([google/adk-python #3974](https://github.com/google/adk-python/issues/3974), [#3754](https://github.com/google/adk-python/issues/3754)) — the bug was 2.5-flash-specific in manifestation but the aggregator code path is shared; the comment in `agent.py` flags this for verification with 3.5.

### Added

- **A2UI v0.9 emission via Google's Python SDK**: the workspace agent now includes `SendA2uiToClientToolset` (from [google/A2UI](https://github.com/google/A2UI)) configured with the basic v0.9 catalog. The agent can call `send_a2ui_json_to_client(a2ui_json=...)` to deliver structured UI to the TypeScript add-on, which renders it as CardService widgets. `WORKSPACE_INSTRUCTION` documents when to prefer A2UI (forms, confirmations, structured selections) vs. plain text (summaries, drafts, explanations), with a worked example.
- Dependency: `a2ui-agent-sdk` from `github.com/google/A2UI@609ab52` (pinned via a `[tool.uv.sources]` git ref — PyPI release pending).
- 2 new tests verifying the toolset is present, the exposed tool name matches the TS middleware's `a2uiToolNames`, and the catalog is v0.9 basic.

## [0.1.0] — 2026-04-16

### Added

- Initial Python workspace agent subproject relocated from `integrations/adk-middleware/python/examples/server/api/google_workspace.py`.
- `SendA2uiToClientToolset` for shared memory across Gmail/Calendar/Docs/Chat via ADK's `InMemoryMemoryService` + `PreloadMemoryTool`.
- `user_id_extractor` that reads a `user_email` Context entry and raises on missing/empty values — anonymous traffic is refused rather than pooled into a shared memory bucket.
- `save_session_to_memory_per_turn=True` for near-real-time cross-surface references.
- Standalone FastAPI server on port 8001 mounted at `/`.
- 13 unit tests covering the user_id extractor and agent configuration.
