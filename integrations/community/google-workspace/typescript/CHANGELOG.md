# Changelog

All notable changes to `@ag-ui/google-workspace` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Railway deployment scaffolding**: production `Dockerfile` and `railway.toml` at the package root, plus matching files for the Python agent at `../python/`. Two-service Railway topology where the TS add-on is public and the Python ADK agent is reached only via Railway private networking (`http://${{gws-agent.RAILWAY_PRIVATE_DOMAIN}}:${{gws-agent.PORT}}/`). The TS Dockerfile is multi-stage: stage 1 builds via the pnpm workspace, stage 2 ships a lean Node runtime with peerDependencies hoisted into `dependencies` and installed from npm. New "Option C — Railway" section in [examples/DEPLOYMENT_GUIDE.md](integrations/community/google-workspace/typescript/examples/DEPLOYMENT_GUIDE.md) walks through the service setup. The existing `examples/Dockerfile` is preserved for users who want a pre-built-`dist/` reference image.

- **A2UI v0.9 rendering**: agents using Google's [A2UI Python SDK](https://github.com/google/A2UI) can now emit structured UI surfaces (buttons, text fields, checkboxes, choice pickers, date/time inputs, images, dividers, column/list/card layouts) that the add-on renders natively as CardService widgets. Surfaces arrive as `ACTIVITY_SNAPSHOT` events from `@ag-ui/a2ui-middleware` and are translated to cards by [src/core/a2ui-renderer.ts](integrations/community/google-workspace/typescript/src/core/a2ui-renderer.ts). Data binding (`{path}` references + `{{path}}` templates) is resolved at render time against the surface's data model. Cards with no A2UI content render as plain conversation cards unchanged — A2UI is purely additive. 27 new renderer tests plus route-level tests for the interaction loop.
- **`POST /actions/a2ui-interact`**: handles user interactions on A2UI-rendered surfaces (button clicks, form submits). Collects `formInputs` keyed by component id, builds an `A2UIUserAction`, and forwards to the agent via `forwardedProps.a2uiAction`. The middleware injects a synthetic `log_a2ui_event` tool call so the agent sees the action. Date/time fields are normalized to ISO 8601 strings before being sent back.
- **`src/cards/widgets.ts`** gains `image()`, `selectionInput()` (CHECK_BOX / RADIO_BUTTON / DROPDOWN / SWITCH), and `dateTimePicker()` builders used by the A2UI renderer.

### Fixed

- **Chat route `threadName` scope** ([src/apps/chat/routes.ts](integrations/community/google-workspace/typescript/src/apps/chat/routes.ts)): `threadName` was declared inside the `try` block but referenced in the `catch` block where it was out of scope. Hoisted to the enclosing scope so error-path responses correctly thread the reply into the same Chat thread. This was the "pre-existing chat `threadName` issue" flagged as known in the design spec §26. `pnpm typecheck` now runs clean.

### Changed

- **`@ag-ui/*` deps moved to the standard monorepo integration pattern.** `@ag-ui/core`, `@ag-ui/client`, and `@ag-ui/a2ui-middleware` are now declared in `peerDependencies` with `>=` version ranges (matching every other integration: langchain, crew-ai, claude-agent-sdk, spring-ai, etc.). The same packages appear in `devDependencies` as `workspace:*` so in-repo `pnpm install` resolves to local sources for typecheck/test. `rxjs@7.8.1` is also pinned in peers + devDeps to match `@ag-ui/a2ui-middleware`'s peer constraint. Fixes the previous setup where `@ag-ui/*` were `dependencies: workspace:*`, which broke external `npm install` (the `workspace:` protocol is pnpm-only).

- **Cross-surface memory via `user_email` context entry**: `runAgent()` now accepts a `userId` option and prepends a canonical `{ description: "user_email", value: <email> }` entry to `RunAgentInput.context`. Route handlers (`/actions/send`, `/actions/approve`, `/actions/reject`, `/chat/event`) pass the authenticated Google user's email through (using `auth.email`, not `auth.userId` — the latter is Google's numeric `sub`, not an email). The Python workspace agent extracts this to set its ADK `user_id`, enabling a shared memory bucket across Gmail/Calendar/Docs/Chat for the same user. Exported `USER_EMAIL_CONTEXT_KEY` constant and `buildOutgoingContext()` helper.

- **Anonymous Chat rejection**: `/chat/event` now short-circuits with a user-facing "requires a signed-in user account" message when the incoming user payload lacks both `user.email` and `user.name` (would otherwise fall back to a synthetic `chat-user-${Date.now()}` / `addon-user-${Date.now()}` ID). Prevents anonymous traffic from being pooled into a shared memory bucket.

- **Initial implementation** of the AG-UI Google Workspace Add-on — a pluggable HTTP-based Workspace Add-on that bridges any AG-UI protocol-compliant backend (LangGraph, CrewAI, Claude Agent SDK, Mastra, ADK middleware, etc.) to Gmail, Google Calendar, Google Docs, and Google Chat.

- **Core**:
  - Hono HTTP server entry point (`src/index.ts`) with health check, homepage trigger, and action routes
  - `AgentRunner` (`src/core/agent-runner.ts`) wrapping `@ag-ui/client`'s `HttpAgent` + `defaultApplyEvents` with a client-side tool execution loop
  - Session store abstraction (`src/core/session.ts`) with `InMemorySessionStore` (dev) and `FirestoreSessionStore` (production)
  - Google ID token / OAuth token auth validation with cached userinfo lookup (`src/core/auth.ts`)
  - Markdown converters for both Workspace card HTML subset (`src/core/markdown-to-html.ts`) and Google Chat's non-standard syntax (`src/core/markdown-to-chat.ts`)
  - Card builders for conversation, settings, and HITL approval cards (`src/cards/*.ts`)
  - Pluggable `HostAppModule` interface and registry (`src/apps/types.ts`, `src/apps/registry.ts`)

- **Gmail module** (`src/apps/gmail/`):
  - Contextual trigger with email context extraction
  - Tools: `read_current_email`, `draft_reply`, `search_inbox`, `read_emails`
  - Full Gmail API draft creation with proper reply threading (In-Reply-To / References headers)
  - Compose action response with `openCreatedDraftActionMarkup` for seamless Gmail compose UI handoff

- **Calendar module** (`src/apps/calendar/`):
  - Event open trigger with context extraction (attendees, conference data, full event details via API)
  - Tools: `read_event_details`, `add_attendee`, `update_event_description`, `update_event_title`, `get_upcoming_events`, `reschedule_event`, `create_event`
  - Capability-aware tool exposure (e.g., `add_attendee` only when user has `canAddAttendees`)

- **Docs module** (`src/apps/docs/`):
  - File-scope-granted trigger with session-persisted doc context
  - Tools: `read_document`, `get_document_outline`, `insert_text`, `replace_text`, `insert_after_text`, `apply_text_format`, `create_bulleted_list`
  - Native Docs API formatting (bold/italic/underline/heading via `updateTextStyle` and `updateParagraphStyle`, bullets via `createParagraphBullets`)

- **Chat module** (`src/apps/chat/`):
  - Webhook handler for both standalone Chat app and Workspace Add-on Chat event formats
  - Tool: `reply_in_thread`
  - Thread-aware responses (replies stay in the originating thread)

- **HITL (Human-in-the-Loop)** approval flow:
  - Write tools pause for explicit user approval before executing
  - Approval card renders the pending action with its parameters
  - Approve/Reject routes handle the resumption with session context restoration (captures `gmail.messageId`, `calendar.id`, `docs.id` that Google strips from card-action events)
  - Pending tool results deferred to the next `/actions/send` so conversation history stays consistent across action-response interruptions

- **Optimistic consent pattern** (applied uniformly across Gmail, Calendar, and Docs):
  - Tools attempt their Google API call first rather than pre-checking `authorizedScopes`
  - On HTTP 403, the tool returns a `requesting_google_scopes` (or `requestFileScopeForActiveDocument` for Docs) action response, triggering Google's native consent prompt
  - User's original message is preserved in `session.pendingUserMessage` across the consent interruption and pre-filled on return, so users don't have to re-type their request after granting permission
  - Shared `withCalendarScopeFallback` / `withFileScopeFallback` wrappers centralize the 403-to-consent translation

- **Deployment tooling**:
  - `examples/deploy.sh` one-shot script to render the deployment descriptor with your URL and register/install via `gcloud workspace-add-ons`
  - Static `examples/deployment.json` template kept in sync with the script
  - `examples/Dockerfile` for Cloud Run deployments
  - `examples/.env.example` documenting all required and optional environment variables (`ACTION_BASE_URL`, `AGUI_DEFAULT_BACKEND_URL`, `AGUI_ALLOWED_BACKENDS`, `INLINE_CONTEXT`, etc.)

- **Documentation**:
  - `README.md` with architecture overview, feature status, quick start, and host-app module reference
  - `examples/DEPLOYMENT_GUIDE.md` — end-to-end deployment walkthrough covering API enablement, OAuth consent screen, Marketplace SDK configuration, OAuth client creation, descriptor deployment, and a "Common Errors" table for the gotchas hit during development
  - Test suite with 135 tests covering core utilities, card rendering, route integration, all four host-app modules, session store, auth, and markdown conversion

- **Python workspace agent** (`integrations/community/google-workspace/python/`):
  - Workspace-aware ADK agent using `gemini-2.0-flash` with a system prompt that explicitly handles the Workspace Add-on interaction model
  - Detailed decision rules covering context access (`state['_ag_ui_context']`), tool selection (title vs. description edits), Chat response formatting, and clickable Gmail link emission for search results
  - `user_id_extractor` reads the authenticated user's email from the `user_email` Context entry and raises on missing/empty values (no anonymous fallback)
  - Shared memory across surfaces for the same user via `PreloadMemoryTool` + `save_session_to_memory_per_turn=True`
  - Standalone FastAPI server on port 8001 (configurable via `PORT`)
  - Replaces the earlier inlined agent at `integrations/adk-middleware/python/examples/server/api/google_workspace.py`

### Known limitations

- **Apps Script port is infeasible**: the current design depends on SSE streaming + async I/O, neither supported by `UrlFetchApp`. Add-on intentionally uses the HTTP add-on runtime on Cloud Run / ngrok.
- **Workspace Add-ons cannot access highlighted text** in Docs/Sheets/Slides — agent must anchor edits by text content instead.
- **30-second sidebar response timeout** — long-running agent workflows are planned for future work via Cloud Tasks + a Refresh button (not yet implemented).
- **A2UI rendering** — rich card output for backends using `@ag-ui/a2ui-middleware` is planned but not yet implemented.
