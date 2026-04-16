# @ag-ui/google-workspace

A Google Workspace Add-on that bridges **any AG-UI protocol-compliant backend** to Gmail, Google Docs, Google Calendar, and Google Chat. Built in TypeScript on Cloud Run, it reuses the existing `@ag-ui/client` and `@ag-ui/core` packages to consume SSE event streams from any supported backend — LangGraph, CrewAI, Claude Agent SDK, Mastra, and 15+ others — and renders responses within Google Workspace's card-based UI.

**One add-on, every backend.** Deploy once, connect any team to any AG-UI agent by changing a URL.

## Architecture

```
Google Workspace (Gmail / Docs / Calendar / Chat)
        │
        │ HTTP POST (card action / trigger)
        ▼
┌────────────────────────────────────────────────────────┐
│  AG-UI Workspace Add-on (TypeScript, Cloud Run)        │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Host App Module (one per app, pluggable)          │  │
│  │  ┌───────────────────┐ ┌─────────────────────┐   │  │
│  │  │ Context Extractor  │ │ Tool Provider       │   │  │
│  │  │ (Gmail API, etc.)  │ │ (generates Tool[],  │   │  │
│  │  └───────────────────┘ │  executes via APIs)  │   │  │
│  │                        └─────────────────────┘   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Protocol Core (generic, host-app-agnostic)        │  │
│  │  Agent Runner  │  Card Renderer  │  Session Store │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
        │
        │ POST RunAgentInput → SSE response
        ▼
  Any AG-UI Backend
```

### Key Design Properties

- **Protocol Core** is generic and host-app-agnostic. Handles AG-UI event streaming, accumulation, session management, card rendering, and HITL flows.
- **Host App Modules** are pluggable, one per Google app. Each module provides context extraction and a tool provider. Adding a new host app means writing a new module; the protocol core doesn't change.
- **The backend never touches Google APIs.** It receives `RunAgentInput` with tools like `read_current_email` or `create_event`, indistinguishable from any other client-side tools.

## Features

| Feature | Status |
|---------|--------|
| Hono HTTP server with health check | Done |
| Homepage trigger (sidebar entry point) | Done |
| Settings card (backend URL + auth config) | Done |
| Session store (Firestore + in-memory) | Done |
| Google bearer token auth validation | Done |
| Conversation card rendering | Done |
| Markdown → card-safe HTML converter | Done |
| Agent runner (`HttpAgent` + `defaultApplyEvents`) | Done |
| HITL approval/rejection flow for write tools | Done |
| Gmail context extraction + contextual trigger | Done |
| Gmail tools (`read_current_email`, `draft_reply`, `search_inbox`, `read_emails`) | Done |
| Calendar context extraction + contextual trigger | Done |
| Calendar tools (`read_event_details`, `add_attendee`, `update_event_description`, `update_event_title`, `get_upcoming_events`, `reschedule_event`, `create_event`) | Done |
| Chat event handler with text responses | Done |
| Chat tools (`reply_in_thread`) | Done |
| Docs context extraction + file scope trigger | Done |
| Docs tools (`read_document`, `get_document_outline`, `insert_text`, `replace_text`, `insert_after_text`, `apply_text_format`, `create_bulleted_list`) | Done |
| Optimistic consent pattern (try API → 403 → native consent prompt) | Done |
| Long-running task support (Cloud Tasks + Refresh) | Planned |
| A2UI rendering (rich card output for A2UI backends) | Planned |

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm (via corepack)
- A Google account (personal @gmail.com works — no Workspace subscription needed)
- An AG-UI backend to connect to

### Install & Run Locally

```bash
# From the monorepo root
pnpm install

# Navigate to the integration
cd integrations/community/google-workspace/typescript

# Run in development mode
pnpm dev

# Or build and start
pnpm build && pnpm start
```

The server starts on `http://localhost:8080` by default.

### Backend agent

For a ready-to-run ADK backend with cross-surface memory, see the sibling Python subproject at [../python/](../python/). It exposes a Gemini-powered workspace agent on port 8001 with a shared memory bucket per authenticated user. Set `AGUI_DEFAULT_BACKEND_URL=http://localhost:8001/` in the add-on's env to point at it. Any AG-UI-compliant backend also works.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `ACTION_BASE_URL` | — | **Required.** Public HTTPS URL of this server (your ngrok or Cloud Run URL). Used to build full URLs for card action buttons. Without it, Send/Approve/etc. buttons fail with a 500 error. |
| `AGUI_DEFAULT_BACKEND_URL` | — | Default AG-UI backend URL (used if user hasn't configured their own) |
| `AGUI_ALLOWED_BACKENDS` | — | Comma-separated hostname patterns (e.g. `*.example.com`) to restrict backend URLs |
| `INLINE_CONTEXT` | — | Set to `1` to inline host-app context (email body, event details, etc.) into the user message text. For AG-UI backends that don't read `RunAgentInput.context`. |
| `GOOGLE_CLOUD_PROJECT` | — | GCP project ID (enables Firestore session store) |
| `FIRESTORE_PROJECT_ID` | — | Alternative to `GOOGLE_CLOUD_PROJECT` |

### Run Tests

```bash
# Unit tests
pnpm test

# With coverage
pnpm test:coverage

# Watch mode
pnpm test:watch
```

## Project Structure

```
src/
  index.ts                      # Hono app entry point + createApp()

  # Protocol Core (generic, host-app-agnostic)
  types.ts                      # Shared type definitions
  core/
    agent-runner.ts             # HttpAgent + defaultApplyEvents + tool exec loop
    card-renderer.ts            # Messages/state → card JSON (future)
    session.ts                  # Firestore + InMemory session stores
    auth.ts                     # Google bearer token validation
    markdown-to-html.ts         # Markdown → card-safe HTML subset

  # Card Templates
  cards/
    conversation.ts             # Main conversation card (sidebar)
    approval.ts                 # HITL tool approval card
    settings.ts                 # Backend configuration card
    widgets.ts                  # Reusable CardService widget builders

  # Host App Modules (pluggable, one per app)
  apps/
    types.ts                    # HostAppModule interface re-export
    registry.ts                 # Maps hostApp → module
    gmail/                      # Gmail module (context + tools + routes)
    calendar/                   # Calendar module
    docs/                       # Docs module
    chat/                       # Chat module

  # Shared Routes
  routes/
    homepage.ts                 # Homepage trigger handler
    actions.ts                  # Send, settings, new-thread actions

tests/
  core/
    session.test.ts             # Session store tests
    card-renderer.test.ts       # Card rendering tests
    markdown-to-html.test.ts    # Markdown converter tests
    auth.test.ts                # Auth validation tests
    routes.test.ts              # Route integration tests

examples/
  deployment.json               # Google Workspace deployment descriptor
  Dockerfile                    # Cloud Run container
  .env.example                  # Environment variable template
```

## Deploying to Google Cloud

> **For step-by-step deployment instructions including all the gotchas, see [`examples/DEPLOYMENT_GUIDE.md`](examples/DEPLOYMENT_GUIDE.md).**


### 1. Create a GCP Project

```bash
gcloud projects create ag-ui-workspace-dev --name="AG-UI Workspace Dev"
gcloud config set project ag-ui-workspace-dev

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  cloudbuild.googleapis.com \
  gsuiteaddons.googleapis.com \
  chat.googleapis.com \
  gmail.googleapis.com \
  docs.googleapis.com

# Create Firestore database
gcloud firestore databases create --location=us-central1
```

### 2. Deploy to Cloud Run

```bash
gcloud run deploy ag-ui-workspace \
  --source=. \
  --region=us-central1 \
  --allow-unauthenticated
```

### 3. Register as a Test Add-on

```bash
# Get the service account
gcloud workspace-add-ons get-authorization

# Deploy descriptor (replace $BASE_URL with your Cloud Run URL)
gcloud workspace-add-ons deployments create ag-ui-agent \
  --deployment-file=examples/deployment.json

# Install on your account
gcloud workspace-add-ons deployments install ag-ui-agent
```

### Local Development with ngrok

For the fastest iteration loop, run locally and expose via ngrok:

```bash
# Terminal 1: Run locally
pnpm dev

# Terminal 2: Expose via ngrok
ngrok http 8080
```

Update `deployment.json` with the ngrok URL, re-deploy the descriptor, and card actions will hit your local server.

## How It Works

### Data Flow (Gmail/Docs Sidebar)

1. User types a message in the sidebar and presses Send
2. Google POSTs to the add-on with action parameters
3. Add-on validates auth and loads session from Firestore
4. Add-on extracts host app context (e.g., email metadata via Gmail API)
5. Add-on generates client-side tools for the current host app
6. `HttpAgent.run()` POSTs `RunAgentInput` to the backend → SSE stream
7. `defaultApplyEvents` accumulates events into final messages + state
8. If agent called a client-side tool → add-on executes it and loops
9. Card renderer converts accumulated state to card JSON
10. Card JSON returned to Google → sidebar updates

### Data Flow (Google Chat)

1. User @mentions the bot or sends a DM
2. Add-on acknowledges immediately ("thinking...")
3. AG-UI call runs in background
4. On completion, response posted via Chat API

### Session Management

Sessions are lightweight — only reconnection metadata (threadId, backendUrl, credentials) is stored in Firestore. Messages and agent state are owned by the backend. The add-on passes `threadId` on each request and the backend resumes from where it left off.

### Tool Categories

| Category | Who Executes | HITL | Example |
|----------|-------------|------|---------|
| Backend tools | The agent backend | No | `web_search`, `rag_query` |
| Read-only client tools | The add-on | No | `read_current_email`, `read_event_details` |
| Write client tools | The add-on | **Yes** | `draft_reply`, `create_event` |

### Adding a New Host App Module

Implement the `HostAppModule` interface:

```typescript
import { HostAppModule, WorkspaceEvent, ToolResult } from "@ag-ui/google-workspace";
import { Context, Tool, ToolCall } from "@ag-ui/core";

const sheetsModule: HostAppModule = {
  hostApp: "SHEETS",

  async extractContext(event: WorkspaceEvent): Promise<Context[]> {
    // Fetch spreadsheet data via Sheets API
    return [{ description: "Current spreadsheet", value: "..." }];
  },

  getTools(event: WorkspaceEvent): Tool[] {
    return [
      { name: "read_sheet", description: "Read the current spreadsheet", parameters: { type: "object", properties: {} } },
    ];
  },

  async executeTool(toolCall: ToolCall, event: WorkspaceEvent): Promise<ToolResult | null> {
    if (toolCall.function.name === "read_sheet") {
      return { result: JSON.stringify({ data: "..." }) };
    }
    return null;
  },

  registerRoutes(app) {
    app.post("/sheets/contextual", async (c) => { /* ... */ });
  },
};
```

Register it in the app:

```typescript
import { createApp, AppRegistry } from "@ag-ui/google-workspace";

const registry = new AppRegistry();
registry.register(sheetsModule);
const app = createApp({ registry });
```

## Account Compatibility

| Account Type | Installation | Notes |
|-------------|-------------|-------|
| **Consumer** (@gmail.com) | Self-service from Marketplace | Full functionality |
| **Workspace** (business/edu) | Admin-pushed or self-service | Org-wide defaults + admin controls |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/homepage` | Homepage trigger (sidebar entry) |
| POST | `/actions/send` | Send a message to the agent |
| POST | `/actions/settings` | Show settings card |
| POST | `/actions/save-settings` | Save backend configuration |
| POST | `/actions/test-connection` | Test backend connectivity |
| POST | `/actions/new-thread` | Clear session and start fresh |
| POST | `/actions/approve` | Approve a pending HITL tool call |
| POST | `/actions/reject` | Reject a pending HITL tool call |
| POST | `/gmail/contextual` | Gmail contextual trigger (email open) |
| POST | `/gmail/compose` | Gmail compose trigger |
| POST | `/calendar/contextual` | Calendar event open trigger |
| POST | `/chat/event` | Chat @mention / DM handler |
| POST | `/docs/file-scope-granted` | Docs file scope granted trigger |

## OAuth Scopes

| Scope | Level | Purpose |
|-------|-------|---------|
| `gmail.addons.current.message.readonly` | Non-sensitive | Read the current email |
| `gmail.addons.current.action.compose` | Non-sensitive | Open compose with pre-filled content |
| `calendar.addons.current.event.read` | Non-sensitive | Read current event attendees/conference |
| `calendar.addons.current.event.write` | Non-sensitive | Stage attendee/conference changes |
| `calendar.events` | Sensitive | Create/modify arbitrary events |
| `drive.file` | Non-sensitive | Per-file access to documents |

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Direct reuse of `@ag-ui/client` and `@ag-ui/core` |
| Runtime | Node.js 18+ | Global `fetch`, configurable timeouts, scale-to-zero |
| HTTP framework | Hono | Lightweight, fast, Cloud Run optimized |
| Session store | Firestore | Serverless, auto-scales, GCP native |
| Auth | Google bearer token | Standard for HTTP add-ons |
| UI model | Card-based (CardService) | Enforced by Google Workspace architecture |

## Contributing

This integration follows the AG-UI community integration pattern. See the [AG-UI Contributing Guide](../../../../CONTRIBUTING.md) for general guidelines.

## License

MIT
