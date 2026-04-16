import type { Context, Tool, ToolCall } from "@ag-ui/core";
import type { HostAppModule, WorkspaceEvent, ToolResult } from "../../types";
import { extractGmailContext } from "./context";
import { getGmailTools, executeGmailTool, isGmailWriteTool } from "./tools";

export { isGmailWriteTool } from "./tools";

/**
 * Gmail host app module.
 *
 * Provides:
 * - Context extraction: email subject, sender, body from the currently viewed message
 * - Tools: read_current_email, draft_reply, search_inbox
 * - Routes: /gmail/contextual, /gmail/compose
 */
export const gmailModule: HostAppModule = {
  hostApp: "GMAIL",

  async extractContext(event: WorkspaceEvent): Promise<Context[]> {
    return extractGmailContext(event);
  },

  getTools(event: WorkspaceEvent): Tool[] {
    return getGmailTools(event);
  },

  async executeTool(
    toolCall: ToolCall,
    event: WorkspaceEvent,
  ): Promise<ToolResult | null> {
    return executeGmailTool(toolCall, event);
  },

  registerRoutes(_app) {
    // Routes are registered separately via createGmailRoutes
    // because they need access to sessionStore and registry
  },
};
