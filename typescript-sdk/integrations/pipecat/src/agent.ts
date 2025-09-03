import { HttpAgent } from "@ag-ui/client";
import { RunAgentInput } from "@ag-ui/core";
import { PipecatAgentConfig } from "./types";

export class PipecatAgent extends HttpAgent {
  constructor(config: PipecatAgentConfig) {
    // Convert PipecatAgentConfig to HttpAgentConfig for the base class
    super({
      url: config.agUIEndpoint,
      headers: config.authHeaders,
    });
  }

  protected requestInit(input: RunAgentInput): RequestInit {
    return {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(input),
      signal: this.abortController.signal,
    };
  }

  // The run method is inherited from HttpAgent, which handles:
  // 1. HTTP POST to this.url (config.agUIEndpoint) 
  // 2. SSE stream processing
  // 3. Event transformation using AG-UI SDK event types
  // No need to override unless we need custom behavior
}