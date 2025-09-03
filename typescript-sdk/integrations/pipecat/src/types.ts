import { AgentConfig } from "@ag-ui/client";

// AG-UI stream configuration only
export interface PipecatAgentConfig extends AgentConfig {
  /** The HTTP endpoint for AG-UI events (e.g., '/api/copilotkit/pipecat') */
  agUIEndpoint: string;
  /** Authentication headers for AG-UI HTTP/SSE requests */
  authHeaders?: Record<string, string>;
}

// RTVI voice stream configuration only - completely separate
export interface PipecatVoiceConfig {
  /** WebSocket URL for RTVI voice communication (e.g., 'ws://localhost:8000/ws') */
  websocketUrl: string;
  /** Authentication headers for RTVI WebSocket connection */
  authHeaders?: Record<string, string>;
  /** Enable microphone input */
  enableMic?: boolean;
  /** Connection timeout in milliseconds */
  timeout?: number;
}