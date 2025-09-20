// Mock the voice components to avoid WebSocketTransport ES module issues
jest.mock("../../../src/voice", () => ({
  PipecatVoice: jest.fn(),
  usePipecatVoice: jest.fn(),
}));

import { PipecatAgent, PipecatAgentConfig, PipecatVoiceConfig } from "../../../src/index";

describe("Pipecat Integration Exports", () => {
  it("should export PipecatAgent", () => {
    expect(PipecatAgent).toBeDefined();
    expect(typeof PipecatAgent).toBe("function");
  });

  it("should export PipecatAgentConfig interface", () => {
    // Test that we can create objects with the exported interface structure
    const config: PipecatAgentConfig = {
      agUIEndpoint: "/test"
    };
    expect(config).toBeDefined();
  });

  it("should export PipecatVoiceConfig interface", () => {
    // Test that we can create objects with the exported interface structure  
    const config: PipecatVoiceConfig = {
      websocketUrl: "ws://test"
    };
    expect(config).toBeDefined();
  });

  it("should allow PipecatAgent instantiation with config", () => {
    // PipecatAgent extends HttpAgent with custom config handling
    // This tests the config conversion and inheritance structure
    const config: PipecatAgentConfig = {
      agUIEndpoint: "/api/test",
      authHeaders: { "Authorization": "Bearer token" }
    };
    
    expect(() => new PipecatAgent(config)).not.toThrow();
  });
});