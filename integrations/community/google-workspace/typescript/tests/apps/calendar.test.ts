import { describe, it, expect } from "vitest";
import { calendarModule, isCalendarWriteTool } from "../../src/apps/calendar/index";
import { extractCalendarContext } from "../../src/apps/calendar/context";
import {
  getCalendarTools,
  executeCalendarTool,
} from "../../src/apps/calendar/tools";
import type { WorkspaceEvent } from "../../src/types";

const baseEvent: WorkspaceEvent = {
  commonEventObject: {
    userLocale: "en",
    hostApp: "CALENDAR",
    platform: "WEB",
  },
};

const calendarEvent: WorkspaceEvent = {
  ...baseEvent,
  calendar: {
    id: "event-123",
    calendarId: "user@example.com",
    organizer: { email: "alice@example.com" },
    attendees: [
      { email: "alice@example.com", displayName: "Alice", responseStatus: "accepted" },
      { email: "bob@example.com", responseStatus: "needsAction" },
    ],
    capabilities: {
      canAddAttendees: true,
      canSeeAttendees: true,
    },
  },
  authorizationEventObject: {
    userOAuthToken: "oauth-token",
    userIdToken: "id-token",
    systemIdToken: "system-token",
  },
};

describe("Calendar Module", () => {
  describe("HostAppModule interface", () => {
    it("has correct hostApp", () => {
      expect(calendarModule.hostApp).toBe("CALENDAR");
    });

    it("extractContext returns contexts", async () => {
      const contexts = await calendarModule.extractContext(baseEvent);
      expect(contexts.length).toBeGreaterThanOrEqual(1);
      expect(contexts[0].value).toBe("CALENDAR");
    });

    it("getTools returns calendar tools", () => {
      const tools = calendarModule.getTools(calendarEvent);
      const names = tools.map((t) => t.name);
      expect(names).toContain("read_event_details");
      expect(names).toContain("add_attendee");
      expect(names).toContain("update_event_description");
      expect(names).toContain("update_event_title");
      expect(names).toContain("create_event");
      expect(names).toContain("get_upcoming_events");
      expect(names).toContain("reschedule_event");
    });

    it("executeTool returns null for unknown tools", async () => {
      const result = await calendarModule.executeTool(
        {
          id: "tc-1",
          type: "function",
          function: { name: "unknown_tool", arguments: "{}" },
        },
        baseEvent,
      );
      expect(result).toBeNull();
    });
  });

  describe("Context Extraction", () => {
    it("returns host app context for events without calendar data", async () => {
      const contexts = await extractCalendarContext(baseEvent);
      expect(contexts).toHaveLength(1);
      expect(contexts[0].value).toBe("CALENDAR");
    });

    it("includes event ID, calendar ID, and organizer", async () => {
      const contexts = await extractCalendarContext(calendarEvent);
      expect(contexts.find((c) => c.value === "event-123")).toBeTruthy();
      expect(contexts.find((c) => c.value === "user@example.com")).toBeTruthy();
      expect(
        contexts.find((c) => c.value === "alice@example.com"),
      ).toBeTruthy();
    });

    it("includes attendee list", async () => {
      const contexts = await extractCalendarContext(calendarEvent);
      const attendeeCtx = contexts.find((c) =>
        c.description.includes("attendees"),
      );
      expect(attendeeCtx).toBeTruthy();
      expect(attendeeCtx!.value).toContain("Alice");
      expect(attendeeCtx!.value).toContain("bob@example.com");
    });
  });

  describe("Tool Definitions", () => {
    it("includes add_attendee when capability allows", () => {
      const tools = getCalendarTools(calendarEvent);
      expect(tools.find((t) => t.name === "add_attendee")).toBeTruthy();
    });

    it("excludes add_attendee when capability denies", () => {
      const event: WorkspaceEvent = {
        ...calendarEvent,
        calendar: {
          ...calendarEvent.calendar!,
          capabilities: { canAddAttendees: false },
        },
      };
      const tools = getCalendarTools(event);
      expect(tools.find((t) => t.name === "add_attendee")).toBeUndefined();
    });

    it("create_event requires summary, start, end", () => {
      const tools = getCalendarTools(calendarEvent);
      const createTool = tools.find((t) => t.name === "create_event");
      expect(createTool?.parameters.required).toContain("summary");
      expect(createTool?.parameters.required).toContain("start");
      expect(createTool?.parameters.required).toContain("end");
    });
  });

  describe("Tool Classification", () => {
    it("add_attendee is a write tool", () => {
      expect(isCalendarWriteTool("add_attendee")).toBe(true);
    });
    it("create_event is a write tool", () => {
      expect(isCalendarWriteTool("create_event")).toBe(true);
    });
    it("update_event_description is a write tool", () => {
      expect(isCalendarWriteTool("update_event_description")).toBe(true);
    });
    it("update_event_title is a write tool", () => {
      expect(isCalendarWriteTool("update_event_title")).toBe(true);
    });
    it("reschedule_event is a write tool", () => {
      expect(isCalendarWriteTool("reschedule_event")).toBe(true);
    });
    it("read_event_details is not a write tool", () => {
      expect(isCalendarWriteTool("read_event_details")).toBe(false);
    });
    it("get_upcoming_events is not a write tool", () => {
      expect(isCalendarWriteTool("get_upcoming_events")).toBe(false);
    });
  });

  describe("Tool Execution", () => {
    it("read_event_details returns error when no event is open", async () => {
      const result = await executeCalendarTool(
        {
          id: "tc-1",
          type: "function",
          function: { name: "read_event_details", arguments: "{}" },
        },
        baseEvent,
      );
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain("No calendar event");
    });

    it("add_attendee returns an action response", async () => {
      const result = await executeCalendarTool(
        {
          id: "tc-1",
          type: "function",
          function: {
            name: "add_attendee",
            arguments: JSON.stringify({ email: "carol@example.com" }),
          },
        },
        calendarEvent,
      );
      expect(result!.isActionResponse).toBe(true);
      expect(result!.actionResponse).toBeTruthy();
    });

    it("create_event returns error when no OAuth token", async () => {
      const result = await executeCalendarTool(
        {
          id: "tc-1",
          type: "function",
          function: {
            name: "create_event",
            arguments: JSON.stringify({
              summary: "Test Event",
              start: "2026-04-20T10:00:00Z",
              end: "2026-04-20T11:00:00Z",
            }),
          },
        },
        baseEvent,
      );
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain("OAuth token");
    });
  });
});
