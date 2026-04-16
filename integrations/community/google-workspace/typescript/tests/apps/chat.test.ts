import { describe, it, expect } from "vitest";
import { chatModule, isChatWriteTool } from "../../src/apps/chat/index";
import { extractChatContext } from "../../src/apps/chat/context";
import { getChatTools, executeChatTool } from "../../src/apps/chat/tools";
import type { WorkspaceEvent } from "../../src/types";

const baseEvent: WorkspaceEvent = {
  commonEventObject: {
    userLocale: "en",
    hostApp: "CHAT",
    platform: "WEB",
  },
};

const chatEvent: WorkspaceEvent = {
  ...baseEvent,
  chat: {
    messagePayload: {
      message: {
        text: "@AgentBot What's the status of project X?",
        name: "spaces/SPACE123/messages/MSG456",
        thread: { name: "spaces/SPACE123/threads/THREAD789" },
      },
    },
    user: {
      name: "users/USER001",
      displayName: "Alice Smith",
      email: "alice@example.com",
    },
    space: {
      name: "spaces/SPACE123",
      type: "ROOM",
    },
  },
  authorizationEventObject: {
    userOAuthToken: "oauth-token",
    userIdToken: "id-token",
    systemIdToken: "system-token",
  },
};

describe("Chat Module", () => {
  describe("HostAppModule interface", () => {
    it("has correct hostApp", () => {
      expect(chatModule.hostApp).toBe("CHAT");
    });

    it("getTools returns chat tools", () => {
      const tools = chatModule.getTools(baseEvent);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("reply_in_thread");
    });

    it("executeTool returns null for unknown tools", async () => {
      const result = await chatModule.executeTool(
        {
          id: "tc-1",
          type: "function",
          function: { name: "unknown_tool", arguments: "{}" },
        },
        baseEvent,
      );
      expect(result).toBeNull();
    });
  });

  describe("Context Extraction", () => {
    it("returns host app context for events without chat data", () => {
      const contexts = extractChatContext(baseEvent);
      expect(contexts).toHaveLength(1);
      expect(contexts[0].value).toBe("CHAT");
    });

    it("includes message text, user info, and space", () => {
      const contexts = extractChatContext(chatEvent);
      expect(
        contexts.find((c) => c.description === "User's chat message"),
      ).toBeTruthy();
      expect(
        contexts.find((c) => c.value === "Alice Smith"),
      ).toBeTruthy();
      expect(
        contexts.find((c) => c.value === "alice@example.com"),
      ).toBeTruthy();
      expect(
        contexts.find((c) => c.value === "spaces/SPACE123"),
      ).toBeTruthy();
      expect(contexts.find((c) => c.value === "ROOM")).toBeTruthy();
    });
  });

  describe("Tool Classification", () => {
    it("reply_in_thread is a write tool", () => {
      expect(isChatWriteTool("reply_in_thread")).toBe(true);
    });
  });

  describe("Tool Execution", () => {
    it("reply_in_thread returns error when no OAuth token", async () => {
      const result = await executeChatTool(
        {
          id: "tc-1",
          type: "function",
          function: {
            name: "reply_in_thread",
            arguments: JSON.stringify({ text: "Hello!" }),
          },
        },
        baseEvent,
      );
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain("OAuth token");
    });

    it("reply_in_thread returns error when no space context", async () => {
      const event: WorkspaceEvent = {
        ...baseEvent,
        authorizationEventObject: {
          userOAuthToken: "token",
          userIdToken: "id",
          systemIdToken: "sys",
        },
      };
      const result = await executeChatTool(
        {
          id: "tc-1",
          type: "function",
          function: {
            name: "reply_in_thread",
            arguments: JSON.stringify({ text: "Hello!" }),
          },
        },
        event,
      );
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain("space context");
    });
  });
});
