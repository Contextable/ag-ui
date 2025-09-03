// Mock the voice components to avoid WebSocketTransport ES module issues
jest.mock("../voice", () => ({
  PipecatVoice: jest.fn(),
  usePipecatVoice: jest.fn(),
}));

import { PipecatHttpAgent, PipecatAgent, PipecatAgentConfig, PipecatVoiceConfig } from "../index";

describe("Pipecat Integration Exports", () => {
  it("should export PipecatHttpAgent", () => {
    expect(PipecatHttpAgent).toBeDefined();
    expect(typeof PipecatHttpAgent).toBe("function");
  });

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

  it("should allow PipecatHttpAgent instantiation", () => {
    // PipecatHttpAgent extends HttpAgent, so it should be instantiable with proper config
    // This tests the basic inheritance structure
    const config = { url: "http://test.com" };
    expect(() => new PipecatHttpAgent(config)).not.toThrow();
  });

  it("should allow PipecatAgent instantiation with config", () => {
    const config: PipecatAgentConfig = {
      agUIEndpoint: "/api/test"
    };
    
    expect(() => new PipecatAgent(config)).not.toThrow();
  });
});