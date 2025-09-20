import { PipecatAgent } from "../../../src/agent";
import { PipecatAgentConfig } from "../../../src/types";
import { HttpAgent } from "@ag-ui/client";

describe("PipecatAgent", () => {
  let agent: PipecatAgent;
  let config: PipecatAgentConfig;

  beforeEach(() => {
    config = {
      agUIEndpoint: "http://localhost:8000/api/copilotkit/pipecat",
      authHeaders: {
        "Authorization": "Bearer test-token"
      }
    };
    agent = new PipecatAgent(config);
  });

  it("should create an instance with valid config", () => {
    expect(agent).toBeInstanceOf(PipecatAgent);
  });

  it("should extend HttpAgent", () => {
    expect(agent).toBeInstanceOf(HttpAgent);
  });

  it("should configure HttpAgent with correct URL and headers", () => {
    // Check that the base HttpAgent was configured correctly
    expect((agent as any).url).toBe(config.agUIEndpoint);
    expect((agent as any).headers).toEqual(config.authHeaders);
  });

  it("should have a run method that returns an Observable", () => {
    expect(typeof agent.run).toBe("function");
  });

  describe("requestInit method", () => {
    it("should generate correct request configuration", () => {
      const input = {
        messages: [],
        tools: [],
        context: [],
        runId: "test-run-id",
        threadId: "test-thread-id"
      };

      const requestInit = (agent as any).requestInit(input);

      expect(requestInit.method).toBe("POST");
      expect(requestInit.headers).toEqual({
        "Authorization": "Bearer test-token",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      });
      expect(requestInit.body).toBe(JSON.stringify(input));
      expect(requestInit.signal).toBeDefined(); // AbortController signal
    });

    it("should handle config without authHeaders", () => {
      const configWithoutAuth: PipecatAgentConfig = {
        agUIEndpoint: "http://localhost:8000/api/copilotkit/pipecat"
      };
      const agentWithoutAuth = new PipecatAgent(configWithoutAuth);

      const input = {
        messages: [],
        tools: [],
        context: [],
        runId: "test-run-id",
        threadId: "test-thread-id"
      };

      const requestInit = (agentWithoutAuth as any).requestInit(input);

      expect(requestInit.headers).toEqual({
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      });
    });
  });

  describe("run method", () => {
    it("should return an Observable", () => {
      const input = {
        messages: [],
        tools: [],
        context: [],
        runId: "test-run-id",
        threadId: "test-thread-id"
      };

      const result = agent.run(input);
      expect(result).toBeDefined();
      expect(typeof result.subscribe).toBe("function");
    });

    it("should handle subscriber cleanup", () => {
      const input = {
        messages: [],
        tools: [],
        context: [],
        runId: "test-run-id", 
        threadId: "test-thread-id"
      };

      const observable = agent.run(input);
      const subscription = observable.subscribe({
        error: () => {} // Expect error since no server is running
      });

      // Should be able to unsubscribe without error
      expect(() => subscription.unsubscribe()).not.toThrow();
    });

    it("should attempt HTTP request with configured endpoint", (done) => {
      const input = {
        messages: [],
        tools: [],
        context: [],
        runId: "test-run-id",
        threadId: "test-thread-id"
      };

      agent.run(input).subscribe({
        next: () => {
          done.fail("Should not emit any values without server");
        },
        error: (error) => {
          // Should get network error since no server is running
          expect(error.message).toMatch(/fetch|Failed to parse URL|Network|Connection/);
          done();
        },
        complete: () => {
          done.fail("Should not complete successfully without server");
        }
      });
    }, 10000); // Longer timeout for network request
  });
});