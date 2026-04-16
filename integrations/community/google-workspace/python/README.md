# AG-UI Google Workspace Agent

Python ADK-backed agent that powers the AG-UI Google Workspace Add-on (see the sibling `typescript/` directory). Exposes an AG-UI protocol endpoint at `/` that the TypeScript add-on connects to.

## Features

- Works across all four Workspace surfaces (Gmail, Calendar, Docs, Chat) via the add-on's dynamic tool injection.
- **Cross-surface memory**: ADK's `InMemoryMemoryService` is shared across the four surfaces for each authenticated user via `PreloadMemoryTool`, so the agent can reference what happened in another surface when the user asks.
- Memory is flushed after every turn (`save_session_to_memory_per_turn=True`), so cross-surface references work immediately instead of waiting for session cleanup.
- Per-user isolation: the authenticated user's email from the add-on is used as the `user_id`. Anonymous requests are refused.

## Requirements

- Python ≥ 3.10
- `uv` (or `pip`) for dependency management
- Either a `GOOGLE_API_KEY` (from https://makersuite.google.com/app/apikey) or Application Default Credentials (`gcloud auth application-default login`).

## Install and run

```bash
cd integrations/community/google-workspace/python
uv sync
export GOOGLE_API_KEY="your-key"
uv run python -m ag_ui_google_workspace_agent.server
```

The server listens on `http://localhost:8001/` by default. Override with `PORT`.

## Connecting the TypeScript add-on

In the add-on's environment (see `typescript/examples/DEPLOYMENT_GUIDE.md`), set:

```bash
AGUI_DEFAULT_BACKEND_URL=http://localhost:8001/
```

The add-on injects the authenticated user's email into `RunAgentInput.context` as `{ description: "user_email", value: "<email>" }` on every request. The agent's `user_id_extractor` reads that entry and uses it as the ADK `user_id`. If the entry is missing or empty, the agent refuses the request — we don't pool anonymous traffic into a shared memory bucket.

> Caveat on `INLINE_CONTEXT=1` (add-on escape hatch): when enabled, all Context entries are prepended into the user message text, which would put the user's email into the LLM prompt. Leave it OFF for the workspace agent — the ADK middleware reads `input.context` natively.

## Production memory

`InMemoryMemoryService` (the default) does not survive process restarts. For production, swap in `VertexAiRagMemoryService` (or any other `BaseMemoryService` implementation) and pass it via `memory_service=...` when constructing `ADKAgent`. The rest of the cross-surface wiring stays unchanged.

## Tests

```bash
uv run pytest
```
