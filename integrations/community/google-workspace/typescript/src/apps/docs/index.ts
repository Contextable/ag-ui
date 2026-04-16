import type { Context, Tool, ToolCall } from "@ag-ui/core";
import type { HostAppModule, WorkspaceEvent, ToolResult } from "../../types";
import { extractDocsContext } from "./context";
import { getDocsTools, executeDocsTool, isDocsWriteTool } from "./tools";

export { isDocsWriteTool } from "./tools";

/**
 * Docs host app module.
 *
 * Provides:
 * - Context extraction: document ID, title, content (if file scope granted)
 * - Tools: read_document, insert_text, replace_text
 * - Routes: /docs/file-scope-granted
 */
export const docsModule: HostAppModule = {
  hostApp: "DOCS",

  async extractContext(event: WorkspaceEvent): Promise<Context[]> {
    return extractDocsContext(event);
  },

  getTools(event: WorkspaceEvent): Tool[] {
    return getDocsTools(event);
  },

  async executeTool(
    toolCall: ToolCall,
    event: WorkspaceEvent,
  ): Promise<ToolResult | null> {
    return executeDocsTool(toolCall, event);
  },

  registerRoutes(_app) {
    // Routes registered separately via createDocsRoutes
  },
};
