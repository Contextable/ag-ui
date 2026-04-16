import type { Context, Tool, ToolCall } from "@ag-ui/core";
import type { HostAppModule, WorkspaceEvent, ToolResult } from "../../types";
import { extractChatContext } from "./context";
import { getChatTools, executeChatTool, isChatWriteTool } from "./tools";

export { isChatWriteTool } from "./tools";

/**
 * Chat host app module.
 *
 * Provides:
 * - Context extraction: message text, user info, space, thread
 * - Tools: reply_in_thread
 * - Routes: /chat/event
 */
export const chatModule: HostAppModule = {
  hostApp: "CHAT",

  async extractContext(event: WorkspaceEvent): Promise<Context[]> {
    return extractChatContext(event);
  },

  getTools(event: WorkspaceEvent): Tool[] {
    return getChatTools(event);
  },

  async executeTool(
    toolCall: ToolCall,
    event: WorkspaceEvent,
  ): Promise<ToolResult | null> {
    return executeChatTool(toolCall, event);
  },

  registerRoutes(_app) {
    // Routes registered separately via createChatRoutes
  },
};
