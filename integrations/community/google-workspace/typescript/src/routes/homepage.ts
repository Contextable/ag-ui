import { Hono } from "hono";
import type { SessionStore } from "../core/session";
import type { AppRegistry } from "../apps/registry";
import { conversationCard } from "../cards/conversation";
import { settingsCard } from "../cards/settings";
import { validateGoogleAuth, AuthError } from "../core/auth";
import type { WorkspaceEvent } from "../types";

export function createHomepageRoutes(
  sessionStore: SessionStore,
  registry: AppRegistry,
) {
  const routes = new Hono();

  /**
   * Homepage trigger — fired when the user opens the add-on sidebar
   * from any host app. Returns the conversation card or settings if not configured.
   */
  routes.post("/homepage", async (c) => {
    const event: WorkspaceEvent = await c.req.json();

    try {
      const auth = await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );

      // Check if user has configured a backend
      const config = await sessionStore.getConfig(auth.userId);
      const defaultBackendUrl = process.env.AGUI_DEFAULT_BACKEND_URL;

      if (!config?.backendUrl && !defaultBackendUrl) {
        // No backend configured — show settings
        return c.json({
          action: {
            navigations: [
              {
                pushCard: settingsCard({
                  message:
                    "Welcome! Configure your AG-UI backend to get started.",
                }),
              },
            ],
          },
        });
      }

      // Show conversation card
      const hostApp = event.commonEventObject?.hostApp ?? "GMAIL";
      const session = await sessionStore.getSession(auth.userId, hostApp);

      return c.json({
        action: {
          navigations: [
            {
              pushCard: conversationCard({
                agentResponse: session
                  ? undefined
                  : "Connected to your AG-UI backend. Send a message to begin.",
              }),
            },
          ],
        },
      });
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json({ error: err.message }, 401);
      }
      console.error("Homepage error:", err);
      return c.json(
        {
          action: {
            navigations: [
              {
                pushCard: conversationCard({
                  error: `Error: ${(err as Error).message}`,
                }),
              },
            ],
          },
        },
      );
    }
  });

  return routes;
}
