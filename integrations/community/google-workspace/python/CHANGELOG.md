# Changelog

All notable changes to `ag-ui-google-workspace-agent` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
