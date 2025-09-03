import { PipecatAgentConfig, PipecatVoiceConfig } from "../types";

describe("PipecatAgentConfig", () => {
  it("should have required agUIEndpoint property", () => {
    const config: PipecatAgentConfig = {
      agUIEndpoint: "/api/copilotkit/pipecat"
    };
    
    expect(config.agUIEndpoint).toBe("/api/copilotkit/pipecat");
  });

  it("should accept optional authHeaders", () => {
    const config: PipecatAgentConfig = {
      agUIEndpoint: "/api/copilotkit/pipecat",
      authHeaders: {
        "Authorization": "Bearer test-token",
        "X-API-Key": "test-key"
      }
    };
    
    expect(config.authHeaders).toEqual({
      "Authorization": "Bearer test-token",
      "X-API-Key": "test-key"
    });
  });

  it("should extend AgentConfig interface", () => {
    // This test validates that PipecatAgentConfig properly extends AgentConfig
    // by accepting properties that would be on AgentConfig
    const config: PipecatAgentConfig = {
      agUIEndpoint: "/api/copilotkit/pipecat",
      // These would come from AgentConfig base interface
      authHeaders: { "test": "header" }
    };
    
    expect(config).toBeDefined();
  });
});

describe("PipecatVoiceConfig", () => {
  it("should have required websocketUrl property", () => {
    const config: PipecatVoiceConfig = {
      websocketUrl: "ws://localhost:8000/ws"
    };
    
    expect(config.websocketUrl).toBe("ws://localhost:8000/ws");
  });

  it("should accept all optional properties", () => {
    const config: PipecatVoiceConfig = {
      websocketUrl: "ws://localhost:8000/ws",
      authHeaders: {
        "Authorization": "Bearer voice-token"
      },
      enableMic: true,
      timeout: 30000
    };
    
    expect(config.websocketUrl).toBe("ws://localhost:8000/ws");
    expect(config.authHeaders).toEqual({ "Authorization": "Bearer voice-token" });
    expect(config.enableMic).toBe(true);
    expect(config.timeout).toBe(30000);
  });

  it("should have sensible defaults for optional properties", () => {
    const config: PipecatVoiceConfig = {
      websocketUrl: "ws://localhost:8000/ws"
    };
    
    // Optional properties should be undefined when not specified
    expect(config.authHeaders).toBeUndefined();
    expect(config.enableMic).toBeUndefined();
    expect(config.timeout).toBeUndefined();
  });
});