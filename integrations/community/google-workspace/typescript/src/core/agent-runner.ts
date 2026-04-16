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
import { randomUUID } from "crypto";
import type { SessionStore } from "./session";
import type { HostAppModule, WorkspaceEvent, ToolResult, HostApp } from "../types";

const MAX_TOOL_LOOPS = 10;
const AGENT_TIMEOUT_MS = 30_000;

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

  const executedToolCalls: Array<{
    name: string;
    status: "completed" | "pending";
  }> = [];

  // Client-side tool name set for quick lookup
  const clientToolNames = new Set(opts.clientTools.map((t) => t.name));

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

    // Filter out context entries with missing/empty values — Pydantic
    // requires `value` to be a non-null string and will 422 the request.
    const cleanContext = opts.context.filter(
      (c) => c.value !== undefined && c.value !== null && c.value !== "",
    );

    const input: RunAgentInput = {
      threadId: opts.threadId,
      runId: randomUUID(),
      messages: [
        ...messages,
        ...(loopCount === 1 ? [userMessage] : []),
        ...(pendingToolMessage ? [pendingToolMessage] : []),
      ],
      tools: opts.clientTools,
      context: cleanContext,
      state: {},
      forwardedProps: {},
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
      const result = await agent.runAgent({
        abortController,
        runId: input.runId,
        tools: input.tools,
        context: input.context,
        forwardedProps: input.forwardedProps,
      });

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

  return {
    responseText,
    messages,
    executedToolCalls,
    actionResponse,
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
