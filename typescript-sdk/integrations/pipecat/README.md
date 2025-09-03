# AG-UI Pipecat Integration

TypeScript integration for connecting Pipecat real-time voice agents with AG-UI event protocol.

## Architecture

This integration implements a dual-path architecture that cleanly separates concerns:

- **AG-UI Event Stream**: HTTP/SSE for structured agent events (text, tools, state changes)
- **RTVI Voice Stream**: WebSocket for real-time voice communication

### Key Components

- `PipecatAgent`: Handles AG-UI event stream (extends `AbstractAgent`)
- `PipecatVoiceConfig`: Configuration for RTVI voice WebSocket connection
- Voice UI Component: Browser-based voice interface (separate from AG-UI events)

## Installation

```bash
pnpm add @ag-ui/pipecat
```

## Usage

### AG-UI Agent (Text/Events)

```typescript
import { PipecatAgent } from "@ag-ui/pipecat";

const agent = new PipecatAgent({
  agUIEndpoint: "/api/copilotkit/pipecat",
  authHeaders: {
    "Authorization": "Bearer your-token"
  }
});

// Use with CopilotKit
<CopilotKit runtimeUrl="/api/copilotkit/pipecat">
  <YourApp />
</CopilotKit>
```

### Voice Component (Separate)

```typescript
import { PipecatVoiceConfig } from "@ag-ui/pipecat";

const voiceConfig: PipecatVoiceConfig = {
  websocketUrl: "ws://localhost:8000/ws",
  enableMic: true,
  timeout: 30000,
  authHeaders: {
    "Authorization": "Bearer your-token"
  }
};

// Voice component handles RTVI WebSocket independently
```

## Server Requirements

Your server must provide:

1. **AG-UI Endpoint** (e.g., `/api/copilotkit/pipecat`):
   - Accept HTTP POST with `RunAgentInput` 
   - Return SSE stream of AG-UI events
   - Handle RTVI→AG-UI conversion server-side

2. **RTVI Voice Endpoint** (e.g., `/ws`):
   - WebSocket endpoint for Pipecat RTVI protocol
   - Handle voice input/output independently

## Development

```bash
# Build
pnpm build

# Test  
pnpm test

# Development
pnpm dev
```

## Status

🚧 **Under Development** - This integration is currently being implemented.