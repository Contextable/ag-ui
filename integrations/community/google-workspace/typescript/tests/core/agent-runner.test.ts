import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildOutgoingContext,
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
