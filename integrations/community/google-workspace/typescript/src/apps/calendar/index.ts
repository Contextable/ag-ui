import type { Context, Tool, ToolCall } from "@ag-ui/core";
import type { HostAppModule, WorkspaceEvent, ToolResult } from "../../types";
import { extractCalendarContext } from "./context";
import {
  getCalendarTools,
  executeCalendarTool,
  isCalendarWriteTool,
} from "./tools";

export { isCalendarWriteTool } from "./tools";

/**
 * Calendar host app module.
 *
 * Provides:
 * - Context extraction: event title, description, start/end, attendees, location
 * - Tools: read_event_details, add_attendee, update_event_description, create_event
 * - Routes: /calendar/contextual
 */
export const calendarModule: HostAppModule = {
  hostApp: "CALENDAR",

  async extractContext(event: WorkspaceEvent): Promise<Context[]> {
    return extractCalendarContext(event);
  },

  getTools(event: WorkspaceEvent): Tool[] {
    return getCalendarTools(event);
  },

  async executeTool(
    toolCall: ToolCall,
    event: WorkspaceEvent,
  ): Promise<ToolResult | null> {
    return executeCalendarTool(toolCall, event);
  },

  registerRoutes(_app) {
    // Routes registered separately via createCalendarRoutes
  },
};
