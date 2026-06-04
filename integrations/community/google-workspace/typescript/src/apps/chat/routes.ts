import { Hono } from "hono";
import { randomUUID } from "crypto";
import type { Message } from "@ag-ui/core";
import type { SessionStore } from "../../core/session";
import type { AppRegistry } from "../../apps/registry";
import { validateGoogleAuth, AuthError } from "../../core/auth";
import { runAgent } from "../../core/agent-runner";
import { markdownToChat } from "../../core/markdown-to-chat";
import { renderA2UISurfaces } from "../../core/a2ui-renderer";
import type { Card } from "../../cards/widgets";
import type { WorkspaceEvent } from "../../types";

/**
 * Pulls the `text` arg out of the most recent `reply_in_thread` tool call,
 * if the agent made one. Tool-rigorous models (e.g. gemini-2.5-pro) use
 * `reply_in_thread` as their channel for the user-visible reply; the tool
 * is fulfilled inline (see apps/chat/tools.ts) and the chat route uses
 * `args.text` as the synchronous response. Falls back to the agent's
 * plain text content (`result.responseText`) when no such tool call exists.
 *
 * Exported for testing.
 */
export function extractReplyInThreadText(
  messages: Message[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg: any = messages[i];
    if (msg.role !== "assistant") continue;
    const toolCalls = msg.toolCalls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) continue;
    for (const tc of toolCalls) {
      if (tc?.function?.name !== "reply_in_thread") continue;
      const rawArgs = tc.function?.arguments;
      if (typeof rawArgs !== "string") continue;
      try {
        const parsed = JSON.parse(rawArgs);
        if (typeof parsed?.text === "string" && parsed.text.trim()) {
          return parsed.text;
        }
      } catch {
        // Malformed args; fall through and keep searching earlier messages.
      }
    }
  }
  return undefined;
}

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
export function chatResponse(
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

/**
 * Heuristic: detects when the agent's text response is actually raw A2UI
 * JSON (which happens when the model writes the operations into its text
 * channel instead of calling the `send_a2ui_json_to_client` tool). We use
 * this to avoid rendering the JSON twice — once as a card, once as noisy
 * text beside it.
 */
export function looksLikeRawA2UI(text: string): boolean {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "");
  return /"(?:createSurface|updateComponents|updateDataModel)"/.test(trimmed);
}

/**
 * Builds a Chat card-message response. Chat can render `cardsV2` entries
 * alongside (optional) text. Structure differs between add-on Chat events
 * and standalone Chat apps — same split as `chatResponse`.
 */
export function chatCardResponse(
  cards: Array<{ cardId: string; card: Card }>,
  isAddon: boolean,
  threadName?: string,
  text?: string,
) {
  if (isAddon) {
    const message: Record<string, any> = { cardsV2: cards };
    if (text) message.text = text;
    if (threadName) message.thread = { name: threadName };
    return {
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: { message },
        },
      },
    };
  }
  const response: Record<string, any> = { cardsV2: cards };
  if (text) response.text = text;
  if (threadName) response.thread = { name: threadName };
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

    // Hoisted so the catch block below can reference threadName in error
    // responses. Populated inside the try when we parse the incoming event.
    let threadName: string | undefined;

    try {
      // Extract message text, user ID, and thread context from either format
      let messageText: string | undefined;
      let userId: string;

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

      // If the agent emitted A2UI, render it as one or more Chat card
      // messages. Otherwise fall back to the plain text response.
      if (result.a2uiOperations && result.a2uiOperations.length > 0) {
        const actionBaseUrl = process.env.ACTION_BASE_URL ?? "";
        const surfaces = renderA2UISurfaces(result.a2uiOperations, {
          actionBaseUrl,
        });
        if (surfaces.length > 0) {
          const cards = surfaces.map((s) => ({
            cardId: s.surfaceId,
            card: s.card,
          }));
          const supplementaryText =
            result.responseText && !looksLikeRawA2UI(result.responseText)
              ? markdownToChat(result.responseText)
              : undefined;
          console.log(
            `[chat/event] A2UI response (${elapsed}ms): ${surfaces.length} surface(s)`,
          );
          return c.json(
            chatCardResponse(cards, isAddon, threadName, supplementaryText),
          );
        }
        // Ops were received but rendering produced nothing — usually a
        // malformed surface (missing root, unknown components). Tell the
        // user something useful rather than the generic "no response".
        // Dump the ops payload so the operator can see what came in;
        // truncated to avoid swamping logs, bypassed with LOG_A2UI_FULL=1.
        const fullDump = process.env.LOG_A2UI_FULL === "1";
        const opsJson = JSON.stringify(result.a2uiOperations);
        const dump = fullDump || opsJson.length <= 2000
          ? opsJson
          : `${opsJson.slice(0, 2000)}…[+${opsJson.length - 2000} chars]`;
        console.warn(
          `[chat/event] A2UI ops received (${result.a2uiOperations.length}) but no surfaces rendered. ops=${dump}`,
        );
        return c.json(
          chatResponse(
            "I tried to render a card but the layout was invalid. Try asking again.",
            isAddon,
            threadName,
          ),
        );
      }

      // Plain text path. Prefer the args of a `reply_in_thread` tool call
      // when present — that's the model's intended reply. (Tool-rigorous
      // models like gemini-2.5-pro use the tool as their channel; tool-shy
      // models like gemini-3.5-flash just emit plain text, which lands in
      // result.responseText.) If neither is present, treat as a silent
      // completion and use a short ack instead of the misleading "no
      // text response" placeholder.
      const replyFromTool = extractReplyInThreadText(result.messages);
      const fallbackText = result.executedToolCalls.length > 0
        ? "Done."
        : "Let me know what you'd like me to do.";
      const responseText = markdownToChat(
        replyFromTool || result.responseText || fallbackText,
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
