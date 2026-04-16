import { Hono } from "hono";
import { randomUUID } from "crypto";
import type { SessionStore } from "../../core/session";
import type { AppRegistry } from "../../apps/registry";
import { validateGoogleAuth, AuthError } from "../../core/auth";
import { runAgent } from "../../core/agent-runner";
import { markdownToChat } from "../../core/markdown-to-chat";
import type { WorkspaceEvent } from "../../types";

/**
 * Builds the correct Chat response based on whether this is a
 * Workspace Add-on or a standalone Chat app.
 *
 * Workspace Add-ons MUST use hostAppDataAction to send messages.
 * Standalone Chat apps use the simple { text } format.
 *
 * If threadName is provided, the response is posted into that thread
 * instead of as a new top-level message.
 */
function chatResponse(
  text: string,
  isAddon: boolean,
  threadName?: string,
) {
  if (isAddon) {
    const message: Record<string, any> = { text };
    if (threadName) {
      message.thread = { name: threadName };
    }
    return {
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: { message },
        },
      },
    };
  }
  // Standalone Chat app format
  const response: Record<string, any> = { text };
  if (threadName) {
    response.thread = { name: threadName };
  }
  return response;
}

export function createChatRoutes(
  sessionStore: SessionStore,
  registry: AppRegistry,
) {
  const routes = new Hono();

  /**
   * Simple echo endpoint for testing Chat connectivity.
   */
  routes.post("/chat/echo", async (c) => {
    const body: any = await c.req.json();
    const isAddon = !!body.commonEventObject;
    const text =
      body.chat?.messagePayload?.message?.argumentText ||
      body.chat?.messagePayload?.message?.text ||
      body.message?.argumentText ||
      body.message?.text ||
      "echo";
    console.log(`[chat/echo] addon=${isAddon} returning: ${text.trim()}`);
    return c.json(chatResponse(`Echo: ${text.trim()}`, isAddon));
  });

  /**
   * Chat event handler — handles @mentions, DMs, and slash commands.
   */
  routes.post("/chat/event", async (c) => {
    const startTime = Date.now();
    const rawBody: any = await c.req.json();

    // Workspace Add-on: has commonEventObject
    // Standalone: has type + message at top level
    const isAddon = !!rawBody.commonEventObject;

    console.log(
      `[chat/event] addon=${isAddon} type=${rawBody.type ?? "n/a"}`,
    );

    try {
      // Extract message text, user ID, and thread context from either format
      let messageText: string | undefined;
      let userId: string;
      let threadName: string | undefined;

      if (isAddon) {
        // Workspace Add-on format
        const event = rawBody as WorkspaceEvent;
        const msgPayload = event.chat?.messagePayload as any;
        messageText =
          msgPayload?.message?.argumentText ||
          event.chat?.messagePayload?.message?.text;
        userId =
          event.chat?.user?.email ||
          event.chat?.user?.name ||
          `addon-user-${Date.now()}`;
        // Thread context — reply into the same thread
        threadName =
          msgPayload?.message?.thread?.name ||
          event.chat?.messagePayload?.message?.thread?.name;
      } else {
        // Standalone Chat app format
        messageText =
          rawBody.message?.argumentText || rawBody.message?.text;
        userId =
          rawBody.user?.email ||
          rawBody.user?.name ||
          `chat-user-${Date.now()}`;
        threadName = rawBody.message?.thread?.name;
      }

      console.log(`[chat/event] threadName=${threadName ?? "none"}`);

      // Handle ADDED_TO_SPACE events
      if (rawBody.type === "ADDED_TO_SPACE") {
        return c.json(
          chatResponse(
            "Thanks for adding me! Send me a message and I'll connect you to your AG-UI agent.",
            isAddon,
            threadName,
          ),
        );
      }

      if (!messageText) {
        return c.json(
          chatResponse(
            "I didn't receive a message. Try again?",
            isAddon,
            threadName,
          ),
        );
      }

      // Strip @mention prefix if present
      const cleanMessage = messageText.replace(/^@\S+\s*/, "").trim();
      if (!cleanMessage) {
        return c.json(
          chatResponse(
            "Hi! Send me a message and I'll connect you to your AG-UI agent.",
            isAddon,
            threadName,
          ),
        );
      }

      // Reject anonymous users — the backend requires an authenticated
      // email to scope per-user memory. Avoid pooling synthetic IDs
      // (`chat-user-${Date.now()}` / `addon-user-${Date.now()}`) into a
      // shared memory bucket.
      if (
        userId.startsWith("chat-user-") ||
        userId.startsWith("addon-user-")
      ) {
        return c.json(
          chatResponse(
            "This assistant requires a signed-in user account. Please use Google Chat with an authenticated account.",
            isAddon,
            threadName,
          ),
        );
      }

      // Resolve backend URL
      const config = await sessionStore.getConfig(userId);
      const backendUrl =
        config?.backendUrl || process.env.AGUI_DEFAULT_BACKEND_URL;

      if (!backendUrl) {
        return c.json(
          chatResponse(
            "No AG-UI backend configured. Please set AGUI_DEFAULT_BACKEND_URL on the server.",
            isAddon,
            threadName,
          ),
        );
      }

      // Load or create session
      let session = await sessionStore.getSession(userId, "CHAT");
      if (!session) {
        session = {
          threadId: randomUUID(),
          backendUrl,
          hostApp: "CHAT",
          credentials: config?.authToken
            ? { token: config.authToken, type: config.authType ?? "bearer" }
            : undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await sessionStore.saveSession(userId, session);
      }

      console.log(
        `[chat/event] user=${userId} message="${cleanMessage.slice(0, 50)}" backend=${session.backendUrl}`,
      );

      // Normalize to WorkspaceEvent for module compatibility
      const event: WorkspaceEvent = isAddon
        ? rawBody
        : {
            commonEventObject: {
              userLocale: "en",
              hostApp: "CHAT",
              platform: "WEB",
            },
            chat: {
              messagePayload: {
                message: {
                  text: messageText,
                  name: rawBody.message?.name ?? "",
                  thread: rawBody.message?.thread,
                },
              },
              user: rawBody.user,
              space: rawBody.space,
            },
          };

      // Get chat module for context and tools
      const chatModule = registry.get("CHAT");
      const context = chatModule
        ? await chatModule.extractContext(event)
        : [
            { description: "Google Workspace host application", value: "CHAT" },
          ];
      const clientTools = chatModule ? chatModule.getTools(event) : [];

      // Run the agent
      const result = await runAgent({
        userMessage: cleanMessage,
        threadId: session.threadId,
        backendUrl: session.backendUrl,
        credentials: session.credentials,
        context,
        clientTools,
        hostAppModule: chatModule,
        workspaceEvent: event,
        userId,
      });

      const elapsed = Date.now() - startTime;
      const responseText = markdownToChat(
        result.responseText ||
          "I processed your request but have no text response.",
      );
      console.log(
        `[chat/event] response (${elapsed}ms): "${responseText.slice(0, 80)}..."`,
      );

      const response = chatResponse(responseText, isAddon, threadName);
      console.log("[chat/event] RESPONSE BODY:", JSON.stringify(response));
      return c.json(response);
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json(
          chatResponse(`Auth error: ${err.message}`, isAddon, threadName),
        );
      }
      console.error("Chat event error:", err);
      return c.json(
        chatResponse(
          `Sorry, an error occurred: ${(err as Error).message}`,
          isAddon,
          threadName,
        ),
      );
    }
  });

  return routes;
}
