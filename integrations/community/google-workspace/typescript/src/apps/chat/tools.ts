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
  event: WorkspaceEvent,
): Promise<ToolResult> {
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken) {
    return { result: JSON.stringify({ error: "No OAuth token available" }) };
  }

  const spaceName = event.chat?.space?.name;
  const threadName = event.chat?.messagePayload?.message?.thread?.name;

  if (!spaceName) {
    return { result: JSON.stringify({ error: "No chat space context" }) };
  }

  try {
    const body: Record<string, any> = {
      text: args.text,
    };

    if (threadName) {
      body.thread = { name: threadName };
    }

    const response = await fetch(
      `https://chat.googleapis.com/v1/${spaceName}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Chat API error: ${response.status}`,
        }),
      };
    }

    const data: any = await response.json();
    return {
      result: JSON.stringify({
        success: true,
        messageName: data.name,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to post message: ${(err as Error).message}`,
      }),
    };
  }
}
