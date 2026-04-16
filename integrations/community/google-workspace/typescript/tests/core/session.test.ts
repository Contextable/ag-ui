import { describe, it, expect, beforeEach } from "vitest";
import { InMemorySessionStore } from "../../src/core/session";
import type { Session, UserConfig } from "../../src/types";

describe("InMemorySessionStore", () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  describe("sessions", () => {
    const session: Session = {
      threadId: "thread-123",
      backendUrl: "https://agent.example.com/agui",
      hostApp: "GMAIL",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    it("returns null for non-existent session", async () => {
      const result = await store.getSession("user1", "GMAIL");
      expect(result).toBeNull();
    });

    it("saves and retrieves a session", async () => {
      await store.saveSession("user1", session);
      const result = await store.getSession("user1", "GMAIL");
      expect(result).not.toBeNull();
      expect(result!.threadId).toBe("thread-123");
      expect(result!.backendUrl).toBe("https://agent.example.com/agui");
      expect(result!.hostApp).toBe("GMAIL");
    });

    it("isolates sessions by host app", async () => {
      await store.saveSession("user1", session);
      await store.saveSession("user1", {
        ...session,
        hostApp: "DOCS",
        threadId: "thread-docs",
      });

      const gmail = await store.getSession("user1", "GMAIL");
      const docs = await store.getSession("user1", "DOCS");
      expect(gmail!.threadId).toBe("thread-123");
      expect(docs!.threadId).toBe("thread-docs");
    });

    it("isolates sessions by user", async () => {
      await store.saveSession("user1", session);
      await store.saveSession("user2", {
        ...session,
        threadId: "thread-user2",
      });

      const u1 = await store.getSession("user1", "GMAIL");
      const u2 = await store.getSession("user2", "GMAIL");
      expect(u1!.threadId).toBe("thread-123");
      expect(u2!.threadId).toBe("thread-user2");
    });

    it("deletes a session", async () => {
      await store.saveSession("user1", session);
      await store.deleteSession("user1", "GMAIL");
      const result = await store.getSession("user1", "GMAIL");
      expect(result).toBeNull();
    });

    it("updates existing session on save", async () => {
      await store.saveSession("user1", session);
      await store.saveSession("user1", {
        ...session,
        backendUrl: "https://new-agent.example.com",
      });
      const result = await store.getSession("user1", "GMAIL");
      expect(result!.backendUrl).toBe("https://new-agent.example.com");
    });
  });

  describe("config", () => {
    const config: UserConfig = {
      backendUrl: "https://agent.example.com/agui",
      authToken: "sk-test-123",
      authType: "bearer",
    };

    it("returns null for non-existent config", async () => {
      const result = await store.getConfig("user1");
      expect(result).toBeNull();
    });

    it("saves and retrieves config", async () => {
      await store.saveConfig("user1", config);
      const result = await store.getConfig("user1");
      expect(result).not.toBeNull();
      expect(result!.backendUrl).toBe("https://agent.example.com/agui");
      expect(result!.authToken).toBe("sk-test-123");
    });

    it("isolates config by user", async () => {
      await store.saveConfig("user1", config);
      await store.saveConfig("user2", {
        ...config,
        backendUrl: "https://other.example.com",
      });

      const u1 = await store.getConfig("user1");
      const u2 = await store.getConfig("user2");
      expect(u1!.backendUrl).toBe("https://agent.example.com/agui");
      expect(u2!.backendUrl).toBe("https://other.example.com");
    });
  });

  describe("clear", () => {
    it("removes all data", async () => {
      await store.saveSession("user1", {
        threadId: "t1",
        backendUrl: "url",
        hostApp: "GMAIL",
        createdAt: 0,
        updatedAt: 0,
      });
      await store.saveConfig("user1", { backendUrl: "url" });
      store.clear();
      expect(await store.getSession("user1", "GMAIL")).toBeNull();
      expect(await store.getConfig("user1")).toBeNull();
    });
  });
});
