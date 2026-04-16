import { describe, it, expect, vi, beforeEach } from "vitest";
import { gmailModule, isGmailWriteTool } from "../../src/apps/gmail/index";
import { extractGmailContext } from "../../src/apps/gmail/context";
import { getGmailTools, executeGmailTool } from "../../src/apps/gmail/tools";
import type { WorkspaceEvent } from "../../src/types";

const baseEvent: WorkspaceEvent = {
  commonEventObject: {
    userLocale: "en",
    hostApp: "GMAIL",
    platform: "WEB",
  },
};

const gmailEvent: WorkspaceEvent = {
  ...baseEvent,
  gmail: {
    messageId: "msg-123",
    threadId: "thread-456",
    accessToken: "gmail-access-token",
  },
  authorizationEventObject: {
    userOAuthToken: "oauth-token",
    userIdToken: "id-token",
    systemIdToken: "system-token",
  },
};

describe("Gmail Module", () => {
  describe("HostAppModule interface", () => {
    it("has correct hostApp", () => {
      expect(gmailModule.hostApp).toBe("GMAIL");
    });

    it("extractContext returns contexts", async () => {
      const contexts = await gmailModule.extractContext(baseEvent);
      expect(contexts.length).toBeGreaterThanOrEqual(1);
      expect(contexts[0].value).toBe("GMAIL");
    });

    it("getTools returns Gmail tools", () => {
      const tools = gmailModule.getTools(baseEvent);
      expect(tools.length).toBe(4);
      const names = tools.map((t) => t.name);
      expect(names).toContain("read_current_email");
      expect(names).toContain("draft_reply");
      expect(names).toContain("search_inbox");
      expect(names).toContain("read_emails");
    });

    it("executeTool returns null for unknown tools", async () => {
      const result = await gmailModule.executeTool(
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
    it("returns host app context for events without gmail data", async () => {
      const contexts = await extractGmailContext(baseEvent);
      expect(contexts).toHaveLength(1);
      expect(contexts[0].value).toBe("GMAIL");
    });

    it("includes messageId and threadId when gmail data is present", async () => {
      // No OAuth token, so it won't try to fetch email content
      const event: WorkspaceEvent = {
        ...baseEvent,
        gmail: {
          messageId: "msg-123",
          threadId: "thread-456",
          accessToken: "token",
        },
      };
      const contexts = await extractGmailContext(event);
      expect(contexts.length).toBeGreaterThanOrEqual(3);
      expect(contexts.find((c) => c.value === "msg-123")).toBeTruthy();
      expect(contexts.find((c) => c.value === "thread-456")).toBeTruthy();
    });

    it("includes compose recipients when available", async () => {
      const event: WorkspaceEvent = {
        ...baseEvent,
        gmail: {
          messageId: "msg-1",
          threadId: "thread-1",
          accessToken: "token",
          toRecipients: ["alice@example.com", "bob@example.com"],
          ccRecipients: ["carol@example.com"],
        },
      };
      const contexts = await extractGmailContext(event);
      const toCtx = contexts.find((c) =>
        c.description.includes("To recipients"),
      );
      expect(toCtx?.value).toBe("alice@example.com, bob@example.com");
      const ccCtx = contexts.find((c) =>
        c.description.includes("CC recipients"),
      );
      expect(ccCtx?.value).toBe("carol@example.com");
    });
  });

  describe("Tool Definitions", () => {
    it("read_current_email has no required parameters", () => {
      const tools = getGmailTools(baseEvent);
      const readTool = tools.find((t) => t.name === "read_current_email");
      expect(readTool?.parameters.required).toBeUndefined();
    });

    it("draft_reply requires body parameter", () => {
      const tools = getGmailTools(baseEvent);
      const draftTool = tools.find((t) => t.name === "draft_reply");
      expect(draftTool?.parameters.required).toContain("body");
    });

    it("search_inbox requires query parameter", () => {
      const tools = getGmailTools(baseEvent);
      const searchTool = tools.find((t) => t.name === "search_inbox");
      expect(searchTool?.parameters.required).toContain("query");
    });

    it("read_emails requires messageIds parameter", () => {
      const tools = getGmailTools(baseEvent);
      const readEmailsTool = tools.find((t) => t.name === "read_emails");
      expect(readEmailsTool?.parameters.required).toContain("messageIds");
      expect(readEmailsTool?.parameters.properties.messageIds.type).toBe(
        "array",
      );
    });
  });

  describe("Tool Classification", () => {
    it("draft_reply is a write tool", () => {
      expect(isGmailWriteTool("draft_reply")).toBe(true);
    });

    it("read_current_email is not a write tool", () => {
      expect(isGmailWriteTool("read_current_email")).toBe(false);
    });

    it("search_inbox is not a write tool", () => {
      expect(isGmailWriteTool("search_inbox")).toBe(false);
    });

    it("read_emails is not a write tool", () => {
      expect(isGmailWriteTool("read_emails")).toBe(false);
    });
  });

  describe("Tool Execution", () => {
    it("read_current_email returns error when no email is open", async () => {
      const result = await executeGmailTool(
        {
          id: "tc-1",
          type: "function",
          function: { name: "read_current_email", arguments: "{}" },
        },
        baseEvent,
      );
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain("No email");
    });

    it("read_current_email returns error when no OAuth token", async () => {
      const event: WorkspaceEvent = {
        ...baseEvent,
        gmail: {
          messageId: "msg-123",
          threadId: "thread-1",
          accessToken: "token",
        },
        // No authorizationEventObject
      };
      const result = await executeGmailTool(
        {
          id: "tc-1",
          type: "function",
          function: { name: "read_current_email", arguments: "{}" },
        },
        event,
      );
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain("OAuth token");
    });

    it("draft_reply returns error without OAuth token", async () => {
      const result = await executeGmailTool(
        {
          id: "tc-1",
          type: "function",
          function: {
            name: "draft_reply",
            arguments: JSON.stringify({
              body: "Thanks for your email!",
            }),
          },
        },
        baseEvent, // no gmail context, no OAuth token
      );
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toBeTruthy();
    });

    it("search_inbox returns error when no OAuth token", async () => {
      const result = await executeGmailTool(
        {
          id: "tc-1",
          type: "function",
          function: {
            name: "search_inbox",
            arguments: JSON.stringify({ query: "from:alice" }),
          },
        },
        baseEvent,
      );
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain("OAuth token");
    });

    it("read_emails returns error when no OAuth token", async () => {
      const result = await executeGmailTool(
        {
          id: "tc-1",
          type: "function",
          function: {
            name: "read_emails",
            arguments: JSON.stringify({ messageIds: ["abc", "def"] }),
          },
        },
        baseEvent, // no OAuth token
      );
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain("OAuth token");
    });

    it("read_emails returns error when messageIds is empty", async () => {
      const result = await executeGmailTool(
        {
          id: "tc-1",
          type: "function",
          function: {
            name: "read_emails",
            arguments: JSON.stringify({ messageIds: [] }),
          },
        },
        gmailEvent, // has OAuth token
      );
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain("messageIds");
    });

    it("returns null for unknown tools", async () => {
      const result = await executeGmailTool(
        {
          id: "tc-1",
          type: "function",
          function: { name: "not_a_gmail_tool", arguments: "{}" },
        },
        baseEvent,
      );
      expect(result).toBeNull();
    });
  });
});
