import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { InMemorySessionStore, FirestoreSessionStore } from "./core/session";
import type { SessionStore } from "./core/session";
import { AppRegistry } from "./apps/registry";
import { createHomepageRoutes } from "./routes/homepage";
import { createActionRoutes } from "./routes/actions";
import { gmailModule } from "./apps/gmail/index";
import { calendarModule } from "./apps/calendar/index";
import { chatModule } from "./apps/chat/index";
import { docsModule } from "./apps/docs/index";
import { createGmailRoutes } from "./apps/gmail/routes";
import { createCalendarRoutes } from "./apps/calendar/routes";
import { createChatRoutes } from "./apps/chat/routes";
import { createDocsRoutes } from "./apps/docs/routes";

export { InMemorySessionStore, FirestoreSessionStore } from "./core/session";
export type { SessionStore } from "./core/session";
export { AppRegistry } from "./apps/registry";
export { runAgent } from "./core/agent-runner";
export type { AgentRunResult, RunAgentOptions } from "./core/agent-runner";
export { validateGoogleAuth, AuthError } from "./core/auth";
export { markdownToHtml, truncateText } from "./core/markdown-to-html";
export { conversationCard } from "./cards/conversation";
export { settingsCard } from "./cards/settings";
export { approvalCard } from "./cards/approval";
export { gmailModule } from "./apps/gmail/index";
export { calendarModule } from "./apps/calendar/index";
export { chatModule } from "./apps/chat/index";
export { docsModule } from "./apps/docs/index";
export * from "./cards/widgets";
export * from "./types";

export interface CreateAppOptions {
  /** Session store implementation. Defaults to InMemorySessionStore. */
  sessionStore?: SessionStore;
  /** App registry with host app modules. Defaults to a registry with all built-in modules. */
  registry?: AppRegistry;
  /** If true, skip auto-registering the built-in host app modules. */
  skipDefaultModules?: boolean;
}

/**
 * Creates the Hono app with all routes wired up.
 * This is the main entry point for the add-on.
 */
export function createApp(options: CreateAppOptions = {}): Hono {
  const sessionStore = options.sessionStore ?? new InMemorySessionStore();
  const registry = options.registry ?? new AppRegistry();

  // Register built-in host app modules
  if (!options.skipDefaultModules && !options.registry) {
    registry.register(gmailModule);
    registry.register(calendarModule);
    registry.register(chatModule);
    registry.register(docsModule);
  }

  const app = new Hono();

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Static assets — logo, favicon, etc. Served from ./assets/ relative
  // to the process cwd. Google Workspace fetches logoUrl from the
  // deployment descriptor; it must resolve over HTTPS with no auth.
  app.get("/assets/*", async (c) => {
    const pathname = new URL(c.req.url).pathname;
    const rel = pathname.replace(/^\/assets\//, "");
    if (!rel || rel.includes("..") || rel.startsWith("/")) {
      return c.text("Not found", 404);
    }
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.join(process.cwd(), "assets", rel);
    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(rel).toLowerCase();
      const mime =
        ext === ".png" ? "image/png" :
        ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
        ext === ".svg" ? "image/svg+xml" :
        ext === ".ico" ? "image/x-icon" :
        "application/octet-stream";
      return new Response(data, {
        headers: { "content-type": mime, "cache-control": "public, max-age=3600" },
      });
    } catch {
      return c.text("Not found", 404);
    }
  });

  // Homepage trigger
  app.route("/", createHomepageRoutes(sessionStore, registry));

  // Action handlers
  app.route("/", createActionRoutes(sessionStore, registry));

  // Host-app-specific routes
  app.route("/", createGmailRoutes(sessionStore, registry));
  app.route("/", createCalendarRoutes(sessionStore, registry));
  app.route("/", createChatRoutes(sessionStore, registry));
  app.route("/", createDocsRoutes(sessionStore, registry));

  return app;
}

// ── Standalone server (when run directly) ──

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/index.ts") ||
    process.argv[1].endsWith("/index.js"));

if (isDirectRun) {
  (async () => {
    const port = parseInt(process.env.PORT ?? "8080", 10);

    let sessionStore: SessionStore;

    if (process.env.FIRESTORE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT) {
      const { Firestore } = await import("@google-cloud/firestore");
      const db = new Firestore({
        projectId:
          process.env.FIRESTORE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
      });
      sessionStore = new FirestoreSessionStore(db);
      console.log("Using Firestore session store");
    } else {
      sessionStore = new InMemorySessionStore();
      console.log("Using in-memory session store (development mode)");
    }

    const app = createApp({ sessionStore });

    console.log(`AG-UI Google Workspace Add-on listening on port ${port}`);
    serve({ fetch: app.fetch, port });
  })();
}
