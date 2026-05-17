import { Hono } from "hono";
import { randomUUID } from "crypto";
import type { SessionStore } from "../core/session";
import type { AppRegistry } from "../apps/registry";
import { runAgent, type AgentRunResult } from "../core/agent-runner";
import { renderA2UISurfaces } from "../core/a2ui-renderer";
import { conversationCard } from "../cards/conversation";
import { settingsCard } from "../cards/settings";
import { approvalCard } from "../cards/approval";
import { validateGoogleAuth, AuthError } from "../core/auth";
import { renderCard } from "../cards/widgets";
import type { WorkspaceEvent, HostApp } from "../types";
import type { A2UIUserAction } from "@ag-ui/a2ui-middleware";

/**
 * Extracts form input values from the Google Workspace event.
 */
function getFormValue(event: WorkspaceEvent, name: string): string {
  return (
    event.commonEventObject?.formInputs?.[name]?.stringInputs?.value?.[0] ?? ""
  );
}

/**
 * Gets a parameter value from the action event.
 */
function getParameter(event: WorkspaceEvent, name: string): string {
  return event.commonEventObject?.parameters?.[name] ?? "";
}

/**
 * Render an agent run result as a card response. Prefers A2UI surfaces
 * when the agent emitted any; otherwise renders a plain conversation card
 * with the agent's text + any executed tool-call summary.
 */
function renderAgentResult(result: AgentRunResult) {
  if (result.a2uiOperations && result.a2uiOperations.length > 0) {
    const actionBaseUrl = process.env.ACTION_BASE_URL ?? "";
    const surfaces = renderA2UISurfaces(result.a2uiOperations, {
      actionBaseUrl,
    });
    if (surfaces.length > 0) {
      // CardService's renderCard envelope takes a single Card. If multiple
      // surfaces exist we render the first and leave the rest for a later
      // turn — sidebars can only show one card at a time.
      return renderCard(surfaces[0].card);
    }
  }
  return renderCard(
    conversationCard({
      agentResponse:
        result.responseText || "Agent completed with no text response.",
      toolCalls: result.executedToolCalls,
    }),
  );
}

/**
 * Validates a backend URL, checking against the allowed backends list if set.
 */
function validateBackendUrl(url: string): { valid: boolean; error?: string } {
  if (!url) {
    return { valid: false, error: "Backend URL is required" };
  }

  try {
    new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  const allowed = process.env.AGUI_ALLOWED_BACKENDS;
  if (allowed) {
    const patterns = allowed.split(",").map((p) => p.trim());
    const hostname = new URL(url).hostname;
    const isAllowed = patterns.some((pattern) => {
      if (pattern.startsWith("*.")) {
        return hostname.endsWith(pattern.slice(1));
      }
      return hostname === pattern;
    });
    if (!isAllowed) {
      return {
        valid: false,
        error: `Backend URL not in allowed list: ${allowed}`,
      };
    }
  }

  return { valid: true };
}

export function createActionRoutes(
  sessionStore: SessionStore,
  registry: AppRegistry,
) {
  const routes = new Hono();

  /**
   * Show settings card.
   */
  routes.post("/actions/settings", async (c) => {
    const event: WorkspaceEvent = await c.req.json();
    try {
      const auth = await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );
      const config = await sessionStore.getConfig(auth.userId);
      return c.json(renderCard(settingsCard({ currentConfig: config })));
    } catch (err) {
      if (err instanceof AuthError) return c.json({ error: err.message }, 401);
      return c.json(
        renderCard(
          settingsCard({ error: `Error: ${(err as Error).message}` }),
        ),
      );
    }
  });

  /**
   * Save settings.
   */
  routes.post("/actions/save-settings", async (c) => {
    const event: WorkspaceEvent = await c.req.json();
    try {
      const auth = await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );

      const backendUrl = getFormValue(event, "backend_url");
      const authToken = getFormValue(event, "auth_token");

      const validation = validateBackendUrl(backendUrl);
      if (!validation.valid) {
        const config = await sessionStore.getConfig(auth.userId);
        return c.json(
          renderCard(settingsCard({ currentConfig: config, error: validation.error })),
        );
      }

      await sessionStore.saveConfig(auth.userId, {
        backendUrl,
        authToken: authToken || undefined,
        authType: authToken ? "bearer" : undefined,
      });

      return c.json(
        renderCard(settingsCard({
          currentConfig: { backendUrl, authToken },
          message: "Settings saved successfully.",
        })),
      );
    } catch (err) {
      if (err instanceof AuthError) return c.json({ error: err.message }, 401);
      return c.json(
        renderCard(
          settingsCard({ error: `Error: ${(err as Error).message}` }),
        ),
      );
    }
  });

  /**
   * Test connection to the backend.
   */
  routes.post("/actions/test-connection", async (c) => {
    const event: WorkspaceEvent = await c.req.json();
    try {
      const auth = await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );

      const config = await sessionStore.getConfig(auth.userId);
      const backendUrl =
        getFormValue(event, "backend_url") ||
        config?.backendUrl ||
        process.env.AGUI_DEFAULT_BACKEND_URL;

      if (!backendUrl) {
        return c.json(
          renderCard(
            settingsCard({
              currentConfig: config,
              error: "No backend URL configured",
            }),
          ),
        );
      }

      // Simple connectivity check — fetch the root or /capabilities endpoint
      const testUrl = backendUrl.replace(/\/$/, "");
      const response = await fetch(testUrl, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      const message = response.ok
        ? `Connection successful (HTTP ${response.status})`
        : `Backend returned HTTP ${response.status}`;

      return c.json(
        renderCard(
          settingsCard({
            currentConfig: config,
            message,
          }),
        ),
      );
    } catch (err) {
      if (err instanceof AuthError) return c.json({ error: err.message }, 401);
      const config = await sessionStore.getConfig("unknown");
      return c.json(
        renderCard(
          settingsCard({
            currentConfig: config,
            error: `Connection failed: ${(err as Error).message}`,
          }),
        ),
      );
    }
  });

  /**
   * Start a new thread — clears the current session.
   */
  routes.post("/actions/new-thread", async (c) => {
    const event: WorkspaceEvent = await c.req.json();
    try {
      const auth = await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );
      const hostApp: HostApp =
        event.commonEventObject?.hostApp ?? "GMAIL";
      await sessionStore.deleteSession(auth.userId, hostApp);

      return c.json(
        renderCard(
          conversationCard({
            agentResponse: "New thread started. Send a message to begin.",
          }),
        ),
      );
    } catch (err) {
      if (err instanceof AuthError) return c.json({ error: err.message }, 401);
      return c.json(
        renderCard(
          conversationCard({ error: `Error: ${(err as Error).message}` }),
        ),
      );
    }
  });

  /**
   * Send a message to the agent.
   * This is the main action handler — wires up the agent runner, executes
   * client-side tools, and returns the conversation card with the response.
   */
  routes.post("/actions/send", async (c) => {
    const event: WorkspaceEvent = await c.req.json();
    try {
      const auth = await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );

      const userMessage = getFormValue(event, "user_message");
      if (!userMessage.trim()) {
        return c.json(
          renderCard(conversationCard({ error: "Please enter a message." })),
        );
      }

      const hostApp: HostApp =
        event.commonEventObject?.hostApp ?? "GMAIL";

      // Resolve backend URL
      const config = await sessionStore.getConfig(auth.userId);
      const backendUrl =
        config?.backendUrl || process.env.AGUI_DEFAULT_BACKEND_URL;

      if (!backendUrl) {
        return c.json(
          renderCard(
            settingsCard({
              message: "Please configure your AG-UI backend URL first.",
            }),
          ),
        );
      }

      // Load or create session
      let session = await sessionStore.getSession(auth.userId, hostApp);
      if (!session) {
        session = {
          threadId: randomUUID(),
          backendUrl,
          hostApp,
          credentials: config?.authToken
            ? { token: config.authToken, type: config.authType ?? "bearer" }
            : undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await sessionStore.saveSession(auth.userId, session);
      }

      // Card-action events strip the original trigger context (e.g.,
      // event.docs.id from /docs/file-scope-granted, event.gmail.messageId
      // from /gmail/contextual). Restore them from the session snapshot
      // captured by the trigger handler.
      const enrichedEvent: WorkspaceEvent = { ...event };
      if (session.hostAppContext?.docs && !event.docs?.id) {
        enrichedEvent.docs = {
          id: session.hostAppContext.docs.id ?? "",
          title: session.hostAppContext.docs.title,
          addonHasFileScopePermission:
            session.hostAppContext.docs.addonHasFileScopePermission,
        };
      }

      // Get host app module for context and tools
      const module = registry.get(hostApp);
      const context = module
        ? await module.extractContext(enrichedEvent)
        : [
            {
              description: "Google Workspace host application",
              value: hostApp,
            },
          ];
      const clientTools = module ? module.getTools(enrichedEvent) : [];

      // If a previous turn produced an action-response tool (e.g.,
      // draft_reply that opened the compose window), the agent's session
      // still has that tool call pending. Consume the stored result here so
      // the agent sees a clean, complete history before this new message.
      const previousMessages = session.pendingToolResult
        ? [
            {
              id: randomUUID(),
              role: "tool" as const,
              toolCallId: session.pendingToolResult.toolCallId,
              content: session.pendingToolResult.content,
            },
          ]
        : undefined;
      if (session.pendingToolResult) {
        console.log(
          `[send] consuming pendingToolResult for tool call ${session.pendingToolResult.toolCallId}`,
        );
        session.pendingToolResult = undefined;
        await sessionStore.saveSession(auth.userId, session);
      }

      // Run the agent
      const result = await runAgent({
        userMessage,
        threadId: session.threadId,
        backendUrl: session.backendUrl,
        credentials: session.credentials,
        context,
        clientTools,
        hostAppModule: module,
        workspaceEvent: enrichedEvent,
        isWriteTool: getWriteToolChecker(hostApp),
        previousMessages,
        userId: auth.email,
      });

      // If a write tool needs HITL approval, show the approval card
      if (result.pendingApproval) {
        // Store the pending tool call in the session
        session.pendingToolCall = {
          toolCallId: result.pendingApproval.toolCall.id,
          toolName: result.pendingApproval.toolName,
          arguments: JSON.stringify(result.pendingApproval.parameters),
          gmailContext: event.gmail
            ? {
                messageId: event.gmail.messageId,
                threadId: event.gmail.threadId,
                accessToken: event.gmail.accessToken,
              }
            : undefined,
          calendarContext: event.calendar
            ? {
                id: event.calendar.id,
                calendarId: event.calendar.calendarId,
              }
            : undefined,
          docsContext: event.docs ? { id: event.docs.id } : undefined,
        };
        await sessionStore.saveSession(auth.userId, session);

        return c.json(
          renderCard(
            approvalCard({
              toolName: result.pendingApproval.toolName,
              description: getToolDescription(result.pendingApproval.toolName),
              parameters: result.pendingApproval.parameters,
              toolCallId: result.pendingApproval.toolCall.id,
            }),
          ),
        );
      }

      // If the agent returned an action response (e.g., ComposeActionResponse,
      // file-scope consent, or granular scope request), return it directly.
      // Store the user's message so it can be recovered after the interruption.
      if (result.actionResponse?.actionResponse) {
        session.pendingUserMessage = userMessage;
        await sessionStore.saveSession(auth.userId, session);
        return c.json(result.actionResponse.actionResponse);
      }

      return c.json(renderAgentResult(result));
    } catch (err) {
      if (err instanceof AuthError) return c.json({ error: err.message }, 401);
      console.error("Send error:", err);
      return c.json(
        renderCard(
          conversationCard({
            error: `Error: ${(err as Error).message}`,
          }),
        ),
      );
    }
  });

  /**
   * Approve a pending write tool call.
   * Executes the tool via the host app module, then re-runs the agent
   * with the tool result so the conversation continues.
   */
  routes.post("/actions/approve", async (c) => {
    const event: WorkspaceEvent = await c.req.json();
    console.log("[approve] RAW BODY:", JSON.stringify(event, null, 2));
    try {
      const auth = await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );

      const toolCallId = getParameter(event, "toolCallId");
      const hostApp: HostApp =
        event.commonEventObject?.hostApp ?? "GMAIL";

      const session = await sessionStore.getSession(auth.userId, hostApp);
      if (!session?.pendingToolCall) {
        return c.json(
          renderCard(
            conversationCard({ error: "No pending action to approve." }),
          ),
        );
      }

      const module = registry.get(hostApp);
      if (!module) {
        return c.json(
          renderCard(
            conversationCard({
              error: "No module available for this host app.",
            }),
          ),
        );
      }

      // Execute the approved tool
      const toolCall = {
        id: session.pendingToolCall.toolCallId,
        type: "function" as const,
        function: {
          name: session.pendingToolCall.toolName,
          arguments: session.pendingToolCall.arguments,
        },
      };

      // Card-action events don't include the original trigger context
      // (e.g. gmail.messageId). Restore it from the session snapshot we
      // captured when the pending tool call was created.
      const restoredEvent: WorkspaceEvent = {
        ...event,
        gmail: session.pendingToolCall.gmailContext
          ? {
              messageId: session.pendingToolCall.gmailContext.messageId ?? "",
              threadId: session.pendingToolCall.gmailContext.threadId ?? "",
              accessToken:
                session.pendingToolCall.gmailContext.accessToken ??
                event.gmail?.accessToken ??
                "",
            }
          : event.gmail,
        calendar: session.pendingToolCall.calendarContext
          ? {
              id: session.pendingToolCall.calendarContext.id ?? "",
              calendarId:
                session.pendingToolCall.calendarContext.calendarId ?? "",
            }
          : event.calendar,
        docs: session.pendingToolCall.docsContext
          ? { id: session.pendingToolCall.docsContext.id ?? "" }
          : event.docs,
      };

      const toolResult = await module.executeTool(toolCall, restoredEvent);
      console.log(
        "[approve] tool result:",
        JSON.stringify(toolResult, null, 2),
      );

      // Clear the pending tool call
      session.pendingToolCall = undefined;
      await sessionStore.saveSession(auth.userId, session);

      // If the tool produced an action response, return it directly.
      // The agent's session has an unresolved tool call from this approval.
      // We defer sending the tool result back to the agent until the user's
      // next interaction — store it on the session and prepend on next /send.
      if (toolResult?.isActionResponse && toolResult.actionResponse) {
        console.log(
          "[approve] returning action response:",
          JSON.stringify(toolResult.actionResponse),
        );

        session.pendingToolResult = {
          toolCallId: toolCall.id,
          content:
            toolResult.result ?? JSON.stringify({ status: "completed" }),
        };
        await sessionStore.saveSession(auth.userId, session);

        return c.json(toolResult.actionResponse);
      }

      // Re-run the agent with the tool result
      const resultMessage = toolResult?.result ?? JSON.stringify({ status: "approved" });

      const config = await sessionStore.getConfig(auth.userId);
      const context = await module.extractContext(event);
      const clientTools = module.getTools(event);

      const agentResult = await runAgent({
        userMessage: "",
        threadId: session.threadId,
        backendUrl: session.backendUrl,
        credentials: session.credentials,
        context,
        clientTools,
        hostAppModule: module,
        workspaceEvent: event,
        isWriteTool: getWriteToolChecker(hostApp),
        previousMessages: [
          {
            id: randomUUID(),
            role: "tool",
            toolCallId: toolCall.id,
            content: resultMessage,
          },
        ],
        userId: auth.email,
      });

      return c.json(
        renderAgentResult({
          ...agentResult,
          responseText:
            agentResult.responseText || "Action completed successfully.",
          executedToolCalls: [
            { name: toolCall.function.name, status: "completed" },
            ...agentResult.executedToolCalls,
          ],
        }),
      );
    } catch (err) {
      if (err instanceof AuthError) return c.json({ error: err.message }, 401);
      console.error("Approve error:", err);
      return c.json(
        renderCard(
          conversationCard({ error: `Error: ${(err as Error).message}` }),
        ),
      );
    }
  });

  /**
   * Reject a pending write tool call.
   * Sends a rejection message to the agent so it can respond accordingly.
   */
  routes.post("/actions/reject", async (c) => {
    const event: WorkspaceEvent = await c.req.json();
    try {
      const auth = await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );

      const hostApp: HostApp =
        event.commonEventObject?.hostApp ?? "GMAIL";

      const session = await sessionStore.getSession(auth.userId, hostApp);
      if (!session?.pendingToolCall) {
        return c.json(
          renderCard(
            conversationCard({ error: "No pending action to reject." }),
          ),
        );
      }

      const toolCallId = session.pendingToolCall.toolCallId;
      const toolName = session.pendingToolCall.toolName;

      // Clear the pending tool call
      session.pendingToolCall = undefined;
      await sessionStore.saveSession(auth.userId, session);

      // Re-run the agent with a rejection message
      const module = registry.get(hostApp);
      const context = module
        ? await module.extractContext(event)
        : [{ description: "Google Workspace host application", value: hostApp }];
      const clientTools = module ? module.getTools(event) : [];

      const agentResult = await runAgent({
        userMessage: "",
        threadId: session.threadId,
        backendUrl: session.backendUrl,
        credentials: session.credentials,
        context,
        clientTools,
        hostAppModule: module,
        workspaceEvent: event,
        isWriteTool: getWriteToolChecker(hostApp),
        previousMessages: [
          {
            id: randomUUID(),
            role: "tool",
            toolCallId,
            content: JSON.stringify({
              status: "rejected",
              message: `User rejected the ${toolName} action.`,
            }),
          },
        ],
        userId: auth.email,
      });

      return c.json(
        renderAgentResult({
          ...agentResult,
          responseText:
            agentResult.responseText ||
            `The ${toolName} action was rejected.`,
          executedToolCalls: [{ name: toolName, status: "completed" }],
        }),
      );
    } catch (err) {
      if (err instanceof AuthError) return c.json({ error: err.message }, 401);
      console.error("Reject error:", err);
      return c.json(
        renderCard(
          conversationCard({ error: `Error: ${(err as Error).message}` }),
        ),
      );
    }
  });

  /**
   * A2UI user-interaction handler. Fires when the user clicks a Button on
   * an A2UI-rendered surface (or submits a form via a Button). Builds an
   * `A2UIUserAction` payload that `@ag-ui/a2ui-middleware` converts into a
   * synthetic `log_a2ui_event` tool call on the agent side, then renders
   * whatever the agent emits in response (another A2UI surface or plain
   * text).
   */
  routes.post("/actions/a2ui-interact", async (c) => {
    const event: WorkspaceEvent = await c.req.json();
    try {
      const auth = await validateGoogleAuth(
        c.req.header("Authorization"),
        event.authorizationEventObject?.userIdToken,
        event.authorizationEventObject?.userOAuthToken,
      );

      const surfaceId = getParameter(event, "surfaceId");
      const componentId = getParameter(event, "componentId");
      const actionName = getParameter(event, "actionName") || "action";

      if (!surfaceId || !componentId) {
        return c.json(
          renderCard(
            conversationCard({
              error:
                "Missing surface/component context on the A2UI interaction.",
            }),
          ),
        );
      }

      const hostApp: HostApp = event.commonEventObject?.hostApp ?? "GMAIL";
      const session = await sessionStore.getSession(auth.userId, hostApp);
      if (!session) {
        return c.json(
          renderCard(
            conversationCard({
              error: "Your session has expired. Please send a new message.",
            }),
          ),
        );
      }

      // Collect every form input on the card into a plain object and hand
      // it to the agent as `context.formValues` keyed by component id.
      const formValues: Record<string, unknown> = {};
      const formInputs = event.commonEventObject?.formInputs ?? {};
      for (const [name, input] of Object.entries(formInputs)) {
        const i = input as {
          stringInputs?: { value?: string[] };
          dateTimeInput?: { msSinceEpoch?: string };
          dateInput?: { msSinceEpoch?: string };
          timeInput?: { hours?: number; minutes?: number };
        };
        const strings = i.stringInputs?.value;
        if (strings && strings.length > 0) {
          // Normalize single-select (still arriving as a 1-item array) to
          // a bare string so the agent doesn't have to unwrap.
          formValues[name] = strings.length === 1 ? strings[0] : strings;
        } else if (i.dateTimeInput?.msSinceEpoch) {
          formValues[name] = new Date(
            Number(i.dateTimeInput.msSinceEpoch),
          ).toISOString();
        } else if (i.dateInput?.msSinceEpoch) {
          formValues[name] = new Date(
            Number(i.dateInput.msSinceEpoch),
          ).toISOString();
        } else if (i.timeInput) {
          formValues[name] = `${i.timeInput.hours ?? 0}:${i.timeInput.minutes ?? 0}`;
        }
      }

      const userAction: A2UIUserAction = {
        name: actionName,
        surfaceId,
        sourceComponentId: componentId,
        context: { formValues },
        timestamp: new Date().toISOString(),
      };

      const module = registry.get(hostApp);
      const context = module
        ? await module.extractContext(event)
        : [{ description: "Google Workspace host application", value: hostApp }];
      const clientTools = module ? module.getTools(event) : [];

      const agentResult = await runAgent({
        userMessage: "",
        threadId: session.threadId,
        backendUrl: session.backendUrl,
        credentials: session.credentials,
        context,
        clientTools,
        hostAppModule: module,
        workspaceEvent: event,
        isWriteTool: getWriteToolChecker(hostApp),
        userId: auth.email,
        a2uiAction: userAction,
      });

      return c.json(renderAgentResult(agentResult));
    } catch (err) {
      if (err instanceof AuthError) return c.json({ error: err.message }, 401);
      console.error("A2UI interact error:", err);
      return c.json(
        renderCard(
          conversationCard({ error: `Error: ${(err as Error).message}` }),
        ),
      );
    }
  });

  return routes;
}

// ── Helpers ──

/** Known write tools by host app */
const WRITE_TOOLS: Record<string, Set<string>> = {
  GMAIL: new Set(["draft_reply"]),
  CALENDAR: new Set([
    "add_attendee",
    "create_event",
    "update_event_description",
    "update_event_title",
    "reschedule_event",
  ]),
  DOCS: new Set([
    "insert_text",
    "replace_text",
    "insert_after_text",
    "apply_text_format",
    "create_bulleted_list",
  ]),
  CHAT: new Set(["reply_in_thread"]),
};

function getWriteToolChecker(hostApp: HostApp): (toolName: string) => boolean {
  const writeTools = WRITE_TOOLS[hostApp] ?? new Set();
  return (toolName: string) => writeTools.has(toolName);
}

/** Human-readable descriptions for tool approval cards */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  draft_reply: "Draft and open a reply to the current email",
  search_inbox: "Search your Gmail inbox",
  add_attendee: "Add an attendee to the current calendar event",
  create_event: "Create a new calendar event",
  update_event_description: "Update the description of the current calendar event",
  update_event_title: "Update the title of the current calendar event",
  reschedule_event: "Change the start and/or end time of the current calendar event",
  insert_text: "Insert text into the current document",
  replace_text: "Replace text in the current document",
  insert_after_text:
    "Insert content after a specific anchor in the current document",
  apply_text_format: "Apply formatting to specific text in the current document",
  create_bulleted_list:
    "Insert a bulleted list into the current document",
  reply_in_thread: "Post a reply in the current Chat thread",
};

function getToolDescription(toolName: string): string {
  return TOOL_DESCRIPTIONS[toolName] ?? `Execute the ${toolName} action`;
}
