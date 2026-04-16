import { Hono } from "hono";
import type { SessionStore } from "../../core/session";
import type { AppRegistry } from "../../apps/registry";
import { validateGoogleAuth, AuthError } from "../../core/auth";
import { conversationCard } from "../../cards/conversation";
import type { WorkspaceEvent } from "../../types";

/**
 * Creates Gmail-specific route handlers.
 */
export function createGmailRoutes(
  sessionStore: SessionStore,
  registry: AppRegistry,
) {
  const routes = new Hono();

  /**
   * Gmail contextual trigger — fired when the user opens an email.
   * Scopes are checked optimistically when tools are called (403 → consent).
   */
  routes.post("/gmail/contextual", async (c) => {
    const event: WorkspaceEvent = await c.req.json();

    try {
      const auth = await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );

      const gmailModule = registry.get("GMAIL");
      let contextInfo = "";

      if (gmailModule && event.gmail?.messageId) {
        try {
          const contexts = await gmailModule.extractContext(event);
          const subject = contexts.find(
            (ctx) => ctx.description === "Email subject",
          )?.value;
          const from = contexts.find(
            (ctx) => ctx.description === "Email sender",
          )?.value;
          if (subject || from) {
            contextInfo = `Viewing email${subject ? `: "${subject}"` : ""}${from ? ` from ${from}` : ""}. Ask me anything about this email.`;
          }
        } catch (err) {
          console.error("Failed to extract Gmail context:", err);
        }
      }

      return c.json({
        action: {
          navigations: [
            {
              pushCard: conversationCard({
                agentResponse:
                  contextInfo ||
                  "I can help with this email. Send a message to get started.",
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

  /**
   * Gmail compose trigger — fired from the compose window.
   */
  routes.post("/gmail/compose", async (c) => {
    const event: WorkspaceEvent = await c.req.json();

    try {
      await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );

      const recipients = event.gmail?.toRecipients?.join(", ") || "unknown";
      return c.json({
        action: {
          navigations: [
            {
              pushCard: conversationCard({
                agentResponse: `Composing to: ${recipients}. I can help you draft this email.`,
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
