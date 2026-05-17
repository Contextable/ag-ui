import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../../src/index";
import { InMemorySessionStore } from "../../src/core/session";
import { AppRegistry } from "../../src/apps/registry";

describe("Route integration tests", () => {
  let app: ReturnType<typeof createApp>;
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
    app = createApp({ sessionStore: store, registry: new AppRegistry() });
  });

  function post(path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    return app.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  const baseEvent = {
    commonEventObject: {
      userLocale: "en",
      hostApp: "GMAIL" as const,
      platform: "WEB" as const,
    },
  };

  describe("GET /health", () => {
    it("returns ok", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "ok" });
    });
  });

  describe("POST /homepage", () => {
    it("shows settings card when no backend configured", async () => {
      const res = await post("/homepage", baseEvent);
      expect(res.status).toBe(200);
      const body = await res.json();
      const card = body.action.navigations[0].pushCard;
      expect(card.header.title).toBe("Settings");
    });

    it("shows conversation card when backend is configured", async () => {
      // Configure a backend URL
      await store.saveConfig("dev-user-" + hashForToken("test-token"), {
        backendUrl: "https://agent.example.com",
      });

      const res = await post("/homepage", baseEvent);
      expect(res.status).toBe(200);
      const body = await res.json();
      const card = body.action.navigations[0].pushCard;
      expect(card.header.title).toBe("AG-UI Agent");
    });

    it("shows conversation card when default backend URL is set", async () => {
      process.env.AGUI_DEFAULT_BACKEND_URL = "https://default-agent.example.com";
      try {
        const res = await post("/homepage", baseEvent);
        expect(res.status).toBe(200);
        const body = await res.json();
        const card = body.action.navigations[0].pushCard;
        expect(card.header.title).toBe("AG-UI Agent");
      } finally {
        delete process.env.AGUI_DEFAULT_BACKEND_URL;
      }
    });
  });

  describe("POST /actions/settings", () => {
    it("returns settings card", async () => {
      const res = await post("/actions/settings", baseEvent);
      expect(res.status).toBe(200);
      const body = await res.json();
      const card =
        body.renderActions.action.navigations[0].pushCard;
      expect(card.header.title).toBe("Settings");
    });
  });

  describe("POST /actions/save-settings", () => {
    it("saves valid settings", async () => {
      const event = {
        ...baseEvent,
        commonEventObject: {
          ...baseEvent.commonEventObject,
          formInputs: {
            backend_url: { stringInputs: { value: ["https://agent.example.com"] } },
            auth_token: { stringInputs: { value: ["sk-123"] } },
          },
        },
      };
      const res = await post("/actions/save-settings", event);
      expect(res.status).toBe(200);
      const body = await res.json();
      const card =
        body.renderActions.action.navigations[0].pushCard;
      // Should show success message
      const firstWidget = card.sections[0].widgets[0];
      expect(firstWidget.decoratedText?.text).toContain("saved");
    });

    it("rejects invalid URL", async () => {
      const event = {
        ...baseEvent,
        commonEventObject: {
          ...baseEvent.commonEventObject,
          formInputs: {
            backend_url: { stringInputs: { value: ["not-a-url"] } },
            auth_token: { stringInputs: { value: [] } },
          },
        },
      };
      const res = await post("/actions/save-settings", event);
      expect(res.status).toBe(200);
      const body = await res.json();
      const card =
        body.renderActions.action.navigations[0].pushCard;
      const firstWidget = card.sections[0].widgets[0];
      expect(firstWidget.decoratedText?.topLabel).toBe("Error");
    });
  });

  describe("POST /actions/new-thread", () => {
    it("clears the session and returns fresh conversation card", async () => {
      // Create a session first
      const userId = "dev-user-" + hashForToken("test-token");
      await store.saveSession(userId, {
        threadId: "old-thread",
        backendUrl: "https://agent.example.com",
        hostApp: "GMAIL",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const res = await post("/actions/new-thread", baseEvent);
      expect(res.status).toBe(200);

      // Session should be deleted
      const session = await store.getSession(userId, "GMAIL");
      expect(session).toBeNull();
    });
  });

  describe("POST /chat/event — anonymous users", () => {
    it("refuses standalone Chat requests without user.email or user.name", async () => {
      const res = await post("/chat/event", {
        type: "MESSAGE",
        message: { text: "hello", thread: { name: "t-1" } },
        // No user field → falls back to chat-user-${Date.now()}
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.text).toContain("requires a signed-in user account");
    });

    it("refuses Workspace Add-on Chat requests without user info", async () => {
      const res = await post("/chat/event", {
        commonEventObject: {
          userLocale: "en",
          hostApp: "CHAT",
          platform: "WEB",
        },
        chat: {
          messagePayload: {
            message: { text: "hello", name: "n", thread: { name: "t-1" } },
          },
          // No user → falls back to addon-user-${Date.now()}
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      // Add-on response shape differs — dig into hostAppDataAction
      const text =
        body.hostAppDataAction?.chatDataAction?.createMessageAction?.message
          ?.text ?? body.text;
      expect(text).toContain("requires a signed-in user account");
    });
  });

  describe("POST /actions/a2ui-interact", () => {
    it("returns a helpful error when surface/component params are missing", async () => {
      const res = await post("/actions/a2ui-interact", baseEvent);
      expect(res.status).toBe(200);
      const body = await res.json();
      const card = body.renderActions.action.navigations[0].pushCard;
      const firstWidget = card.sections[0].widgets[0];
      expect(firstWidget.decoratedText?.text).toContain(
        "Missing surface/component context",
      );
    });

    it("returns an expired-session error when no session exists for the user", async () => {
      const event = {
        ...baseEvent,
        commonEventObject: {
          ...baseEvent.commonEventObject,
          parameters: {
            surfaceId: "s1",
            componentId: "btn",
            actionName: "submit",
          },
        },
      };
      const res = await post("/actions/a2ui-interact", event);
      expect(res.status).toBe(200);
      const body = await res.json();
      const card = body.renderActions.action.navigations[0].pushCard;
      const firstWidget = card.sections[0].widgets[0];
      expect(firstWidget.decoratedText?.text).toContain(
        "session has expired",
      );
    });
  });
});

/** Reproduce the hash logic from auth.ts for test assertions */
function hashForToken(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
