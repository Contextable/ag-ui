import { Hono } from "hono";
import { randomUUID } from "crypto";
import type { SessionStore } from "../../core/session";
import type { AppRegistry } from "../../apps/registry";
import { validateGoogleAuth, AuthError } from "../../core/auth";
import { conversationCard } from "../../cards/conversation";
import type { WorkspaceEvent } from "../../types";

export function createDocsRoutes(
  sessionStore: SessionStore,
  registry: AppRegistry,
) {
  const routes = new Hono();

  /**
   * Docs file scope granted trigger — fired after the user grants
   * per-file access to the add-on for the current document.
   */
  routes.post("/docs/file-scope-granted", async (c) => {
    const event: WorkspaceEvent = await c.req.json();

    try {
      const auth = await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );

      // Capture the doc context on the session so subsequent /actions/send
      // calls (which don't include event.docs) can restore it.
      let session = await sessionStore.getSession(auth.userId, "DOCS");
      if (!session) {
        session = {
          threadId: randomUUID(),
          backendUrl: process.env.AGUI_DEFAULT_BACKEND_URL ?? "",
          hostApp: "DOCS",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }
      // The file-scope-granted trigger fires AFTER the user granted
      // per-file access. Hard-set the permission flag to true regardless
      // of what the event contains — some event payloads omit it.
      session.hostAppContext = {
        docs: {
          id: event.docs?.id,
          title: event.docs?.title,
          addonHasFileScopePermission: true,
        },
      };
      await sessionStore.saveSession(auth.userId, session);
      console.log(
        `[docs/file-scope-granted] saved doc context: id=${event.docs?.id} title=${event.docs?.title}`,
      );

      const title = event.docs?.title || "this document";

      // If the user's message was interrupted by the file-scope consent,
      // pre-fill it so they just click Send instead of retyping.
      const pendingMessage = session.pendingUserMessage;
      if (pendingMessage) {
        session.pendingUserMessage = undefined;
        await sessionStore.saveSession(auth.userId, session);
      }

      return c.json({
        action: {
          navigations: [
            {
              pushCard: conversationCard({
                agentResponse: pendingMessage
                  ? `Access granted to "${title}". Your previous request is ready — click Send to continue.`
                  : `I now have access to "${title}". I can read, insert, replace, and format text. What would you like me to do?`,
                prefillMessage: pendingMessage,
              }),
            },
          ],
        },
      });
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json({ error: err.message }, 401);
      }
      return c.json({
        action: {
          navigations: [
            {
              pushCard: conversationCard({
                error: `Error: ${(err as Error).message}`,
              }),
            },
          ],
        },
      });
    }
  });

  return routes;
}
