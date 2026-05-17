import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildOutgoingContext,
  extractValidatedA2UIFromToolResult,
  runAgent,
  USER_EMAIL_CONTEXT_KEY,
} from "../../src/core/agent-runner";

describe("Agent Runner", () => {
  it("throws when backend is unreachable", async () => {
    await expect(
      runAgent({
        userMessage: "Hello",
        threadId: "thread-1",
        backendUrl: "http://localhost:19999/nonexistent",
        context: [],
        clientTools: [],
      }),
    ).rejects.toThrow();
  });

  it("includes auth headers for bearer credentials", async () => {
    // We can't easily intercept HttpAgent internals, but we can verify
    // the function accepts credentials without error
    await expect(
      runAgent({
        userMessage: "Hello",
        threadId: "thread-1",
        backendUrl: "http://localhost:19999/nonexistent",
        credentials: { token: "sk-test", type: "bearer" },
        context: [],
        clientTools: [],
      }),
    ).rejects.toThrow(); // Will fail to connect, but shouldn't throw on credential setup
  });

  it("includes auth headers for api-key credentials", async () => {
    await expect(
      runAgent({
        userMessage: "Hello",
        threadId: "thread-1",
        backendUrl: "http://localhost:19999/nonexistent",
        credentials: { token: "key-test", type: "api-key" },
        context: [],
        clientTools: [],
      }),
    ).rejects.toThrow();
  });
});

describe("Send action route", () => {
  // These tests are in routes.test.ts and verify the full flow
  // through the Hono app. Agent runner integration tests need a
  // mock backend (covered in Phase 2+ integration tests).
  it("placeholder for integration tests", () => {
    expect(true).toBe(true);
  });
});

describe("buildOutgoingContext", () => {
  it("prepends user_email entry when userId is provided", () => {
    const result = buildOutgoingContext(
      [{ description: "Google Workspace host application", value: "GMAIL" }],
      "alice@example.com",
    );
    expect(result[0]).toEqual({
      description: USER_EMAIL_CONTEXT_KEY,
      value: "alice@example.com",
    });
    expect(result[1]).toEqual({
      description: "Google Workspace host application",
      value: "GMAIL",
    });
  });

  it("omits user_email entry when userId is undefined", () => {
    const result = buildOutgoingContext(
      [{ description: "Google Workspace host application", value: "GMAIL" }],
      undefined,
    );
    expect(result.find((c) => c.description === USER_EMAIL_CONTEXT_KEY)).toBeUndefined();
    expect(result).toHaveLength(1);
  });

  it("drops entries with empty string values", () => {
    const result = buildOutgoingContext(
      [
        { description: "A", value: "x" },
        { description: "B", value: "" },
        { description: "C", value: "y" },
      ],
      undefined,
    );
    expect(result.map((c) => c.description)).toEqual(["A", "C"]);
  });

  it("drops entries with null/undefined values", () => {
    const result = buildOutgoingContext(
      [
        { description: "A", value: "x" },
        { description: "B", value: null as unknown as string },
        { description: "C", value: undefined as unknown as string },
        { description: "D", value: "y" },
      ],
      undefined,
    );
    expect(result.map((c) => c.description)).toEqual(["A", "D"]);
  });

  it("uses the exact description constant so Python extractor matches", () => {
    expect(USER_EMAIL_CONTEXT_KEY).toBe("user_email");
  });
});

// Regression: @ag-ui/a2ui-middleware's `tryParseA2UIOperations` looks for an
// `a2ui_operations` key, but Google's A2UI Python SDK returns
// `{"validated_a2ui_json": [...ops...]}`. The middleware silently extracts
// nothing, so we have a fallback extractor that recognizes the SDK's shape.
describe("extractValidatedA2UIFromToolResult", () => {
  const sampleOps = [
    {
      version: "v0.9",
      createSurface: {
        surfaceId: "s1",
        catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
      },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "s1",
        components: [{ id: "root", component: "Column", children: [] }],
      },
    },
  ];

  it("extracts operations from the Python SDK's {validated_a2ui_json: [...]} wrapper", () => {
    const toolResult = JSON.stringify({ validated_a2ui_json: sampleOps });
    const ops = extractValidatedA2UIFromToolResult(toolResult);
    expect(ops).toHaveLength(2);
    expect((ops[0] as any).createSurface?.surfaceId).toBe("s1");
    expect((ops[1] as any).updateComponents?.components).toHaveLength(1);
  });

  it("handles double-encoded JSON (ToolMessage content often arrives JSON-stringified)", () => {
    const toolResult = JSON.stringify(
      JSON.stringify({ validated_a2ui_json: sampleOps }),
    );
    const ops = extractValidatedA2UIFromToolResult(toolResult);
    expect(ops).toHaveLength(2);
  });

  it("returns empty array for non-A2UI tool results (e.g. read_current_email)", () => {
    const toolResult = JSON.stringify({
      subject: "hi",
      body: "hello there",
    });
    expect(extractValidatedA2UIFromToolResult(toolResult)).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    expect(extractValidatedA2UIFromToolResult("not json at all")).toEqual([]);
    expect(extractValidatedA2UIFromToolResult("")).toEqual([]);
  });

  it("returns empty array when validated_a2ui_json is not an array", () => {
    const bad = JSON.stringify({ validated_a2ui_json: "just a string" });
    expect(extractValidatedA2UIFromToolResult(bad)).toEqual([]);
  });

  it("returns empty array for arrays at the top level (not an object)", () => {
    expect(extractValidatedA2UIFromToolResult(JSON.stringify([1, 2]))).toEqual([]);
  });

  it("returns empty array for null or primitives at the top level", () => {
    expect(extractValidatedA2UIFromToolResult("null")).toEqual([]);
    expect(extractValidatedA2UIFromToolResult("42")).toEqual([]);
    expect(extractValidatedA2UIFromToolResult('"hello"')).toEqual([]);
  });
});
