import { HttpAgent } from "@ag-ui/client";
import type {
  RunAgentInput,
  Message,
  Tool,
  Context,
  BaseEvent,
  ToolCall,
} from "@ag-ui/core";
import { EventType } from "@ag-ui/core";
import {
  A2UIActivityType,
  A2UIMiddleware,
  A2UI_OPERATIONS_KEY,
  type A2UIUserAction,
} from "@ag-ui/a2ui-middleware";
import { randomUUID } from "crypto";
import type { SessionStore } from "./session";
import type { HostAppModule, WorkspaceEvent, ToolResult, HostApp } from "../types";
import type { A2UIOperation } from "./a2ui-renderer";

/**
 * Tool name the Python A2UI SDK's `SendA2uiToClientToolset` exposes.
 * The `@ag-ui/a2ui-middleware` listens for tool calls with this name so it
 * can parse A2UI JSON out of the tool's arguments / result and emit
 * ACTIVITY_SNAPSHOT events we can render.
 */
export const A2UI_SEND_TOOL_NAME = "send_a2ui_json_to_client";

/**
 * Key the Google A2UI Python SDK's `SendA2uiToClientToolset` uses when
 * it wraps the validated operations in the tool result. Matches
 * `a2ui.adk.send_a2ui_to_client_toolset.VALIDATED_A2UI_JSON_KEY`.
 */
const VALIDATED_A2UI_JSON_KEY = "validated_a2ui_json";

/**
 * Extract A2UI operations from a `send_a2ui_json_to_client` tool result.
 *
 * The TS `@ag-ui/a2ui-middleware`'s `tryParseA2UIOperations` looks for a
 * `a2ui_operations` key at the top level — but Google's A2UI Python SDK
 * returns `{"validated_a2ui_json": [...ops...]}` instead. Different key,
 * so the middleware extracts nothing and ops are silently lost. This
 * picks them up.
 *
 * The tool result arrives as a JSON string. It can be wrapped in an
 * extra layer in some ADK configurations (e.g. a ToolMessage whose
 * content is JSON-encoded), so we try both direct and double-encoded
 * shapes.
 *
 * Exported for testing.
 */
export function extractValidatedA2UIFromToolResult(
  resultContent: string,
): A2UIOperation[] {
  if (!resultContent) return [];
  const tryExtract = (obj: unknown): A2UIOperation[] => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
    const ops = (obj as Record<string, unknown>)[VALIDATED_A2UI_JSON_KEY];
    if (!Array.isArray(ops)) return [];
    // v0.9 ops are themselves { version, createSurface?|updateComponents?|... }
    // objects. We let the renderer sort out which fields each has.
    return ops as A2UIOperation[];
  };
  try {
    const direct = tryExtract(JSON.parse(resultContent));
    if (direct.length > 0) return direct;
  } catch {
    // not direct JSON; maybe double-encoded
  }
  try {
    const inner = JSON.parse(JSON.parse(resultContent));
    return tryExtract(inner);
  } catch {
    return [];
  }
}

const MAX_TOOL_LOOPS = 10;
const AGENT_TIMEOUT_MS = 30_000;

/**
 * Canonical Context entry description used to carry the authenticated
 * user's email to the backend agent. The Python-side
 * `extract_user_email` extractor looks for an entry with this exact
 * description; see `integrations/community/google-workspace/python`.
 */
export const USER_EMAIL_CONTEXT_KEY = "user_email";

/**
 * Build the outgoing context array for a request: prepend a user_email
 * entry (if a userId was provided) and drop entries with missing/empty
 * values (which would 422 at the Pydantic layer).
 *
 * Exported for testing.
 */
export function buildOutgoingContext(
  context: Context[],
  userId?: string,
): Context[] {
  const withUser: Context[] = userId
    ? [{ description: USER_EMAIL_CONTEXT_KEY, value: userId }, ...context]
    : context;
  return withUser.filter(
    (c) => c.value !== undefined && c.value !== null && c.value !== "",
  );
}

export interface AgentRunResult {
  /** The agent's final text response (last assistant message content) */
  responseText: string;
  /** All messages after the run */
  messages: Message[];
  /** Tool calls that were executed during the run (for display) */
  executedToolCalls: Array<{ name: string; status: "completed" | "pending" }>;
  /** Whether a tool returned an action response (terminates the card flow) */
  actionResponse?: ToolResult;
  /** Pending write tool call that needs HITL approval */
  pendingApproval?: {
    toolCall: ToolCall;
    toolName: string;
    parameters: Record<string, unknown>;
  };
  /**
   * A2UI operations accumulated from ACTIVITY_SNAPSHOT events during the run,
   * keyed by the emitting event's messageId. The renderer groups them into
   * surfaces internally; this list is the raw operations as the backend
   * emitted them. Empty when the agent produced no A2UI.
   */
  a2uiOperations: A2UIOperation[];
}

export interface RunAgentOptions {
  /** User's message text */
  userMessage: string;
  /** The session's AG-UI thread ID */
  threadId: string;
  /** Backend URL */
  backendUrl: string;
  /** Backend auth credentials */
  credentials?: { token: string; type: "bearer" | "api-key" };
  /** Host app context entries */
  context: Context[];
  /** Client-side tools injected by the host app module */
  clientTools: Tool[];
  /** The host app module to execute client-side tool calls */
  hostAppModule?: HostAppModule;
  /** The original workspace event (for tool execution context) */
  workspaceEvent?: WorkspaceEvent;
  /** Previous messages (for multi-turn, if not managed by backend) */
  previousMessages?: Message[];
  /** Function to check if a tool is a write tool (requires HITL approval) */
  isWriteTool?: (toolName: string) => boolean;
  /**
   * Authenticated user's email. Injected as a `user_email` Context entry
   * so the backend agent can set its ADK user_id and share memory across
   * Workspace surfaces for the same user. Required for any backend that
   * relies on per-user memory isolation; the Python workspace agent
   * refuses requests without it.
   */
  userId?: string;
  /**
   * User interaction payload for an A2UI surface (button click, form
   * submit, etc.). Forwarded to the backend via `forwardedProps.a2uiAction`,
   * which the `@ag-ui/a2ui-middleware` recognizes and converts into a
   * synthetic `log_a2ui_event` tool call in the conversation. Only set on
   * requests originating from /actions/a2ui-interact.
   */
  a2uiAction?: A2UIUserAction;
}

/**
 * Runs the AG-UI agent and handles the client-side tool execution loop.
 *
 * Flow:
 * 1. Build RunAgentInput with user message, context, and client tools
 * 2. HttpAgent.runAgent() → streams events → defaultApplyEvents accumulates
 * 3. Check for pending client-side tool calls
 * 4. If found: execute tool, add ToolMessage, re-run agent
 * 5. Repeat until no more client-side tools or max loops reached
 * 6. Return the final response text and messages
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const headers: Record<string, string> = {};
  if (opts.credentials) {
    if (opts.credentials.type === "bearer") {
      headers["Authorization"] = `Bearer ${opts.credentials.token}`;
    } else {
      headers["x-api-key"] = opts.credentials.token;
    }
  }

  const agent = new HttpAgent({
    url: opts.backendUrl,
    headers,
    threadId: opts.threadId,
    initialMessages: opts.previousMessages ?? [],
    initialState: {},
  });

  // Install the A2UI middleware so ACTIVITY_SNAPSHOT events surface from
  // the agent's tool calls to send_a2ui_json_to_client. We DON'T inject a
  // render_a2ui tool — our agents use the Python SDK's toolset instead.
  agent.use(
    new A2UIMiddleware({
      injectA2UITool: false,
      a2uiToolNames: [A2UI_SEND_TOOL_NAME],
    }),
  );

  const executedToolCalls: Array<{
    name: string;
    status: "completed" | "pending";
  }> = [];

  // Client-side tool name set for quick lookup
  const clientToolNames = new Set(opts.clientTools.map((t) => t.name));

  // A2UI operations accumulate across the run (and across loop iterations);
  // the last set the agent emits wins, so we reset each iteration and
  // collect again via the subscriber below.
  let a2uiOperations: A2UIOperation[] = [];

  // Track the raw a2ui_json arg the agent emitted, plus the raw tool result
  // string the Python A2UI SDK returned. Logged together if extraction
  // ultimately produces zero ops, so we can see what the model actually
  // produced vs. what came back validated. Trimmed in logs to a manageable
  // size; full payload at debug level only.
  let lastA2UIToolCallArgs: string | undefined;
  let lastA2UIToolResultContent: string | undefined;

  const a2uiSubscriber = {
    onActivitySnapshotEvent({ event }: { event: { activityType: string; content: Record<string, unknown> } }) {
      if (event.activityType !== A2UIActivityType) return;
      const ops = event.content[A2UI_OPERATIONS_KEY];
      if (Array.isArray(ops)) {
        a2uiOperations = a2uiOperations.concat(ops as A2UIOperation[]);
      }
    },
    // Fallback path: @ag-ui/a2ui-middleware's `tryParseA2UIOperations` looks
    // for a top-level `a2ui_operations` key, but Google's A2UI Python SDK
    // returns `{"validated_a2ui_json": [...ops...]}`. Different key →
    // middleware extracts nothing. Pick them up ourselves.
    onToolCallResultEvent({ event }: { event: { content: string; toolCallId: string } }) {
      const fallback = extractValidatedA2UIFromToolResult(event.content);
      if (fallback.length > 0) {
        a2uiOperations = a2uiOperations.concat(fallback);
      } else if (event.content) {
        // Stash for the post-run diagnostic. We don't know yet whether the
        // agent had earlier success or whether this is the only A2UI
        // attempt — let the run finish, then decide if we need to dump.
        lastA2UIToolResultContent = event.content;
      }
    },
  };

  let messages = opts.previousMessages ?? [];
  let loopCount = 0;
  let pendingToolMessage: Message | null = null;
  let actionResponse: ToolResult | undefined;

  // Optionally prepend context to user message (for backends that don't
  // read RunAgentInput.context). Enable by setting INLINE_CONTEXT=1.
  const inlineContext = process.env.INLINE_CONTEXT === "1";
  const userContent =
    inlineContext && opts.context.length > 0
      ? `Context:\n${opts.context.map((c) => `- ${c.description}: ${c.value}`).join("\n")}\n\n---\n\nUser: ${opts.userMessage}`
      : opts.userMessage;

  const userMessage: Message = {
    id: randomUUID(),
    role: "user",
    content: userContent,
  };

  while (loopCount < MAX_TOOL_LOOPS) {
    loopCount++;

    // Prepend the authenticated user's email as a canonical context entry
    // so the backend can extract a stable user_id for per-user memory.
    // Drops entries with missing/empty values (Pydantic 422 otherwise).
    const cleanContext = buildOutgoingContext(opts.context, opts.userId);

    // Only attach a2uiAction on the FIRST iteration — it represents a user
    // interaction with a rendered surface, which should produce a single
    // synthetic log_a2ui_event tool call, not be reinjected on each loop.
    const forwardedProps: Record<string, unknown> =
      loopCount === 1 && opts.a2uiAction
        ? { a2uiAction: { userAction: opts.a2uiAction } }
        : {};

    const input: RunAgentInput = {
      threadId: opts.threadId,
      runId: randomUUID(),
      messages: [
        ...messages,
        ...(loopCount === 1 && opts.userMessage ? [userMessage] : []),
        ...(pendingToolMessage ? [pendingToolMessage] : []),
      ],
      tools: opts.clientTools,
      context: cleanContext,
      state: {},
      forwardedProps,
    };

    console.log(
      `[agent-runner] FULL INPUT JSON:`,
      JSON.stringify(input),
    );

    console.log(
      `[agent-runner] loop=${loopCount} tools=${input.tools.length} contexts=${input.context.length}`,
    );
    console.log(
      `[agent-runner] context entries:`,
      JSON.stringify(input.context, null, 2),
    );
    console.log(
      `[agent-runner] tools:`,
      input.tools.map((t) => t.name).join(", "),
    );
    console.log(
      `[agent-runner] FULL TOOL SCHEMA:`,
      JSON.stringify(input.tools, null, 2),
    );

    // Update agent messages for this run
    agent.messages = input.messages;

    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      AGENT_TIMEOUT_MS,
    );

    try {
      const result = await agent.runAgent(
        {
          abortController,
          runId: input.runId,
          tools: input.tools,
          context: input.context,
          forwardedProps: input.forwardedProps,
        },
        a2uiSubscriber,
      );

      messages = result.newMessages;
      pendingToolMessage = null;

      console.log(
        `[agent-runner] loop=${loopCount} newMessages=${messages.length}`,
      );
      for (const msg of messages) {
        const summary: any = { role: msg.role, id: msg.id };
        if ("content" in msg && msg.content) {
          summary.content =
            typeof msg.content === "string"
              ? msg.content.slice(0, 150)
              : JSON.stringify(msg.content).slice(0, 150);
        }
        if ("toolCalls" in msg && msg.toolCalls?.length) {
          summary.toolCalls = msg.toolCalls.map((tc: any) => ({
            name: tc.function?.name,
            args: tc.function?.arguments?.slice(0, 100),
          }));
          // Snapshot the most recent A2UI tool-call args. We pair this
          // with the validated tool result later in the diagnostic dump
          // so a malformed A2UI run shows both "what the model emitted"
          // and "what the SDK accepted".
          for (const tc of msg.toolCalls as any[]) {
            if (tc.function?.name === A2UI_SEND_TOOL_NAME && tc.function?.arguments) {
              lastA2UIToolCallArgs = tc.function.arguments;
            }
          }
        }
        console.log(`[agent-runner]   msg:`, JSON.stringify(summary));
      }

      // Check for pending client-side tool calls in the latest assistant message
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant");

      if (
        lastAssistant &&
        "toolCalls" in lastAssistant &&
        lastAssistant.toolCalls?.length
      ) {
        const pendingClientToolCalls = lastAssistant.toolCalls.filter(
          (tc: ToolCall) => clientToolNames.has(tc.function.name),
        );

        if (pendingClientToolCalls.length > 0 && opts.hostAppModule) {
          const tc = pendingClientToolCalls[0];

          // Check if this is a write tool that needs HITL approval
          if (opts.isWriteTool?.(tc.function.name)) {
            const args = JSON.parse(tc.function.arguments || "{}");
            return {
              responseText: extractResponseText(messages),
              messages,
              executedToolCalls,
              a2uiOperations,
              pendingApproval: {
                toolCall: tc,
                toolName: tc.function.name,
                parameters: args,
              },
            };
          }

          // Execute the read-only client-side tool call
          const toolResult = await opts.hostAppModule.executeTool(
            tc,
            opts.workspaceEvent!,
          );

          if (toolResult) {
            executedToolCalls.push({
              name: tc.function.name,
              status: "completed",
            });

            if (toolResult.isActionResponse) {
              // Action response terminates the card flow
              actionResponse = toolResult;
              break;
            }

            // Add tool result message and re-run
            pendingToolMessage = {
              id: randomUUID(),
              role: "tool",
              toolCallId: tc.id,
              content: toolResult.result,
            };
            continue;
          }
        }
      }

      // No more client-side tools to execute — we're done
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Extract the final text response
  const responseText = extractResponseText(messages);

  // A2UI diagnostic. If the agent emitted a `send_a2ui_json_to_client` tool
  // call (so we captured its args) AND we ended up with zero validated
  // operations, dump both sides so the operator can see what went wrong.
  // Common causes: model produced text-with-JSON instead of a real tool
  // call; JSON failed Python-side schema validation; SDK returned an
  // error string instead of validated_a2ui_json. Truncated to keep log
  // lines manageable; bump LOG_A2UI_FULL=1 for unbounded payloads.
  if (lastA2UIToolCallArgs && a2uiOperations.length === 0) {
    const fullDump = process.env.LOG_A2UI_FULL === "1";
    const cap = fullDump ? Infinity : 2000;
    const trim = (s: string) =>
      s.length > cap ? `${s.slice(0, cap)}…[+${s.length - cap} chars]` : s;
    console.warn(
      `[agent-runner] A2UI extraction yielded 0 ops despite tool call. ` +
        `Dumping payloads for diagnosis (set LOG_A2UI_FULL=1 for full text):`,
    );
    console.warn(
      `[agent-runner]   A2UI tool-call args (what the model emitted): ${trim(lastA2UIToolCallArgs)}`,
    );
    console.warn(
      `[agent-runner]   A2UI tool result (what the SDK returned): ${trim(
        lastA2UIToolResultContent ?? "<none — tool result event never fired>",
      )}`,
    );
  }

  return {
    responseText,
    messages,
    executedToolCalls,
    actionResponse,
    a2uiOperations,
  };
}

/**
 * Extracts the final text response from the accumulated messages.
 */
function extractResponseText(messages: Message[]): string {
  // Find the last assistant message with text content
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && "content" in msg && msg.content) {
      return msg.content;
    }
  }
  return "";
}
