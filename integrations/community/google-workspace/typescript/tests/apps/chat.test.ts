import { describe, it, expect } from "vitest";
import { chatModule, isChatWriteTool } from "../../src/apps/chat/index";
import { extractChatContext } from "../../src/apps/chat/context";
import { getChatTools, executeChatTool } from "../../src/apps/chat/tools";
import {
  chatCardResponse,
  chatResponse,
  looksLikeRawA2UI,
} from "../../src/apps/chat/routes";
import type { Card } from "../../src/cards/widgets";
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

describe("chatResponse envelope", () => {
  it("wraps add-on text messages in hostAppDataAction", () => {
    const r = chatResponse("hi", true) as any;
    expect(r.hostAppDataAction?.chatDataAction?.createMessageAction?.message)
      .toEqual({ text: "hi" });
  });

  it("returns plain { text } for standalone Chat apps", () => {
    const r = chatResponse("hi", false) as any;
    expect(r).toEqual({ text: "hi" });
  });

  it("attaches thread.name when present", () => {
    const standalone = chatResponse("hi", false, "spaces/X/threads/T") as any;
    expect(standalone.thread).toEqual({ name: "spaces/X/threads/T" });
    const addon = chatResponse("hi", true, "spaces/X/threads/T") as any;
    expect(
      addon.hostAppDataAction.chatDataAction.createMessageAction.message.thread,
    ).toEqual({ name: "spaces/X/threads/T" });
  });
});

describe("chatCardResponse envelope", () => {
  const card: Card = {
    sections: [{ widgets: [{ textParagraph: { text: "hi" } }] }],
  };
  const cards = [{ cardId: "s1", card }];

  it("wraps add-on cardsV2 in hostAppDataAction", () => {
    const r = chatCardResponse(cards, true) as any;
    const msg = r.hostAppDataAction?.chatDataAction?.createMessageAction?.message;
    expect(msg?.cardsV2).toEqual(cards);
    expect(msg?.text).toBeUndefined();
    expect(msg?.thread).toBeUndefined();
  });

  it("returns plain { cardsV2 } for standalone Chat apps", () => {
    const r = chatCardResponse(cards, false) as any;
    expect(r.cardsV2).toEqual(cards);
  });

  it("includes supplementary text when provided", () => {
    const r = chatCardResponse(cards, false, undefined, "see below") as any;
    expect(r.text).toBe("see below");
    expect(r.cardsV2).toEqual(cards);
  });

  it("includes thread.name when provided", () => {
    const r = chatCardResponse(cards, false, "spaces/X/threads/T") as any;
    expect(r.thread).toEqual({ name: "spaces/X/threads/T" });
  });

  it("add-on path attaches thread.name inside the message", () => {
    const r = chatCardResponse(cards, true, "spaces/X/threads/T", "hi") as any;
    const msg = r.hostAppDataAction.chatDataAction.createMessageAction.message;
    expect(msg.thread).toEqual({ name: "spaces/X/threads/T" });
    expect(msg.text).toBe("hi");
    expect(msg.cardsV2).toEqual(cards);
  });
});

describe("looksLikeRawA2UI", () => {
  it("flags raw createSurface JSON", () => {
    expect(
      looksLikeRawA2UI(
        '[{"version":"v0.9","createSurface":{"surfaceId":"s"}}]',
      ),
    ).toBe(true);
  });

  it("flags raw updateComponents JSON", () => {
    expect(
      looksLikeRawA2UI(
        '{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[]}}',
      ),
    ).toBe(true);
  });

  it("flags a JSON block wrapped in markdown code fences", () => {
    const fenced = [
      "```json",
      '[{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[]}}]',
      "```",
    ].join("\n");
    expect(looksLikeRawA2UI(fenced)).toBe(true);
  });

  it("does NOT flag normal conversational text", () => {
    expect(looksLikeRawA2UI("Sure, here's the summary you asked for.")).toBe(false);
    expect(looksLikeRawA2UI("I'll create a surface with buttons.")).toBe(false);
    expect(looksLikeRawA2UI("")).toBe(false);
  });

  it("does NOT flag text that merely mentions the words", () => {
    expect(
      looksLikeRawA2UI(
        "To create a surface, I'd use the send_a2ui_json_to_client tool.",
      ),
    ).toBe(false);
  });
});
