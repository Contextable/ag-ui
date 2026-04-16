import { Hono } from "hono";
import type { SessionStore } from "../../core/session";
import type { AppRegistry } from "../../apps/registry";
import { validateGoogleAuth, AuthError } from "../../core/auth";
import { conversationCard } from "../../cards/conversation";
import type { WorkspaceEvent } from "../../types";

export function createCalendarRoutes(
  sessionStore: SessionStore,
  registry: AppRegistry,
) {
  const routes = new Hono();

  /**
   * Calendar contextual trigger — fired when the user opens a calendar event.
   * Scopes are checked optimistically when tools are called (403 → consent).
   */
  routes.post("/calendar/contextual", async (c) => {
    const event: WorkspaceEvent = await c.req.json();

    try {
      const auth = await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );

      const calendarModule = registry.get("CALENDAR");
      let contextInfo = "";

      if (calendarModule && event.calendar?.id) {
        try {
          const contexts = await calendarModule.extractContext(event);
          const title = contexts.find(
            (ctx) => ctx.description === "Event title",
          )?.value;
          const organizer = contexts.find(
            (ctx) => ctx.description === "Event organizer email",
          )?.value;
          if (title) {
            contextInfo = `Viewing event: "${title}"${organizer ? ` (organized by ${organizer})` : ""}. Ask me anything about this event.`;
          }
        } catch (err) {
          console.error("Failed to extract Calendar context:", err);
        }
      }

      return c.json({
        action: {
          navigations: [
            {
              pushCard: conversationCard({
                agentResponse:
                  contextInfo ||
                  "I can help with this calendar event. Send a message to get started.",
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
