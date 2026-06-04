import type { Tool, ToolCall } from "@ag-ui/core";
import type { WorkspaceEvent, ToolResult } from "../../types";

/**
 * Returns Chat tools injected into RunAgentInput.
 */
export function getChatTools(_event: WorkspaceEvent): Tool[] {
  return [
    {
      name: "reply_in_thread",
      description:
        "Post a follow-up message in the current Google Chat thread.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The message text to post in the thread",
          },
        },
        required: ["text"],
      },
    },
  ];
}

export function isChatWriteTool(toolName: string): boolean {
  return toolName === "reply_in_thread";
}

export async function executeChatTool(
  toolCall: ToolCall,
  event: WorkspaceEvent,
): Promise<ToolResult | null> {
  const name = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments || "{}");

  switch (name) {
    case "reply_in_thread":
      return executeReplyInThread(args, event);
    default:
      return null;
  }
}

async function executeReplyInThread(
  args: { text: string },
  _event: WorkspaceEvent,
): Promise<ToolResult> {
  // Inline-fulfill: do not call the Chat REST API. Two reasons:
  //
  // 1. Workspace Add-on Chat events deliver replies via the **synchronous**
  //    `/chat/event` response (`hostAppDataAction.chatDataAction.createMessageAction`).
  //    Google posts the message for us based on what we return. A separate
  //    REST POST would either duplicate the message or 401/403 because
  //    add-on Chat events do not populate `authorizationEventObject.userOAuthToken`
  //    — Google doesn't grant a posting-capable token because it doesn't
  //    need to.
  // 2. Tool-rigorous models (e.g. gemini-2.5-pro) will always reach for a
  //    tool named "reply in thread" when asked to reply in a Chat thread.
  //    If the tool fails, the agent loops, sees the error, and produces
  //    an apology like "I'm having technical difficulties" instead of the
  //    intended reply. Tool-shy models (e.g. gemini-3.5-flash) tend to
  //    skip the tool and emit plain text, which made the same broken
  //    OAuth path look fine in practice.
  //
  // So we accept the tool call, echo the text in the result, and rely on
  // the chat route to lift `args.text` into the synchronous response
  // (see extractReplyInThreadText in apps/chat/routes.ts).
  //
  // Asynchronous follow-up messages (progress updates after the initial
  // reply has already been posted) would need a real REST path with a
  // service-account token or a separate OAuth scope grant. That's a
  // future feature — out of scope here.
  return {
    result: JSON.stringify({ success: true, text: args.text }),
  };
}
