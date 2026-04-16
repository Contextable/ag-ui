import type { Tool, ToolCall } from "@ag-ui/core";
import type { WorkspaceEvent, ToolResult, CalendarCapabilities } from "../../types";

const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

class CalendarScopeError extends Error {
  constructor() {
    super("Calendar events scope not granted");
    this.name = "CalendarScopeError";
  }
}

function calendarScopeConsentResponse(): ToolResult {
  return {
    result: JSON.stringify({
      status: "missing_scope",
      scope: CALENDAR_EVENTS_SCOPE,
    }),
    isActionResponse: true,
    actionResponse: {
      requesting_google_scopes: { scopes: [CALENDAR_EVENTS_SCOPE] },
    },
  };
}

function withCalendarScopeFallback(
  fn: () => Promise<ToolResult>,
): Promise<ToolResult> {
  return fn().catch((err) => {
    if (err instanceof CalendarScopeError) return calendarScopeConsentResponse();
    return {
      result: JSON.stringify({ error: `Calendar error: ${err.message}` }),
    };
  });
}

/**
 * Returns Calendar tools, dynamically adjusted based on the user's
 * capabilities for the current event.
 */
export function getCalendarTools(event: WorkspaceEvent): Tool[] {
  const capabilities = event.calendar?.capabilities;

  const tools: Tool[] = [
    {
      name: "read_event_details",
      description:
        "Read the full details of the calendar event the user is viewing, including title, description, start/end times, location, attendees, and conference link.",
      parameters: { type: "object", properties: {} },
    },
  ];

  if (!capabilities || capabilities.canAddAttendees) {
    tools.push({
      name: "add_attendee",
      description:
        "Add an attendee to the current calendar event. The user must click Save in Calendar to confirm the change.",
      parameters: {
        type: "object",
        properties: {
          email: {
            type: "string",
            description: "Email address of the attendee to add",
          },
          optional: {
            type: "boolean",
            description: "Whether attendance is optional (default: false)",
          },
        },
        required: ["email"],
      },
    });
  }

  tools.push({
    name: "update_event_description",
    description: "Update the description/notes of the current calendar event.",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "New event description",
        },
      },
      required: ["description"],
    },
  });

  tools.push({
    name: "get_upcoming_events",
    description:
      "List the user's upcoming calendar events. Useful for answering 'what's on my calendar' or finding the next meeting.",
    parameters: {
      type: "object",
      properties: {
        maxResults: {
          type: "number",
          description: "Maximum number of events to return (default: 10, max: 25)",
        },
        timeMin: {
          type: "string",
          description:
            "ISO 8601 start of the range (default: now). Use this to look ahead — e.g., 'tomorrow at 9am' for tomorrow's schedule.",
        },
        timeMax: {
          type: "string",
          description:
            "ISO 8601 end of the range (default: 7 days from timeMin).",
        },
      },
    },
  });

  tools.push({
    name: "reschedule_event",
    description:
      "Change the start and/or end time of the current calendar event. Use this when the user wants to move a meeting to a different time.",
    parameters: {
      type: "object",
      properties: {
        start: {
          type: "string",
          description: "New start time (ISO 8601). Optional if only changing end.",
        },
        end: {
          type: "string",
          description: "New end time (ISO 8601). Optional if only changing start.",
        },
      },
    },
  });

  tools.push({
    name: "update_event_title",
    description:
      "Update the title (summary) of the current calendar event. Use this when the user wants to rename the event — do NOT put the title in the description.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "New event title" },
      },
      required: ["title"],
    },
  });

  tools.push({
    name: "create_event",
    description: "Create a new calendar event on the user's primary calendar.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title" },
        start: { type: "string", description: "Start time (ISO 8601)" },
        end: { type: "string", description: "End time (ISO 8601)" },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Attendee email addresses",
        },
        description: { type: "string", description: "Event description" },
        location: { type: "string", description: "Event location" },
      },
      required: ["summary", "start", "end"],
    },
  });

  return tools;
}

export function isCalendarWriteTool(toolName: string): boolean {
  return [
    "add_attendee",
    "create_event",
    "update_event_description",
    "update_event_title",
    "reschedule_event",
  ].includes(toolName);
}

export async function executeCalendarTool(
  toolCall: ToolCall,
  event: WorkspaceEvent,
): Promise<ToolResult | null> {
  const name = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments || "{}");

  let executor: (() => Promise<ToolResult>) | null = null;
  switch (name) {
    case "read_event_details":
      executor = () => executeReadEventDetails(event);
      break;
    case "add_attendee":
      executor = () => executeAddAttendee(args, event);
      break;
    case "update_event_description":
      executor = () => executeUpdateDescription(args, event);
      break;
    case "update_event_title":
      executor = () => executeUpdateTitle(args, event);
      break;
    case "get_upcoming_events":
      executor = () => executeGetUpcomingEvents(args, event);
      break;
    case "reschedule_event":
      executor = () => executeRescheduleEvent(args, event);
      break;
    case "create_event":
      executor = () => executeCreateEvent(args, event);
      break;
    default:
      return null;
  }
  return withCalendarScopeFallback(executor);
}

async function executeReadEventDetails(
  event: WorkspaceEvent,
): Promise<ToolResult> {
  if (!event.calendar?.id) {
    return { result: JSON.stringify({ error: "No calendar event is open" }) };
  }

  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken) {
    return { result: JSON.stringify({ error: "No OAuth token available" }) };
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendar.calendarId)}/events/${encodeURIComponent(event.calendar.id)}`,
      {
        headers: { Authorization: `Bearer ${oauthToken}` },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (response.status === 403) throw new CalendarScopeError();
    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Calendar API error: ${response.status}`,
        }),
      };
    }

    const data: any = await response.json();

    return {
      result: JSON.stringify({
        summary: data.summary,
        description: data.description,
        start: data.start,
        end: data.end,
        location: data.location,
        attendees: event.calendar.attendees,
        conferenceData: event.calendar.conferenceData,
        hangoutLink: data.hangoutLink,
        htmlLink: data.htmlLink,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to read event: ${(err as Error).message}`,
      }),
    };
  }
}

async function executeAddAttendee(
  args: { email: string; optional?: boolean },
  _event: WorkspaceEvent,
): Promise<ToolResult> {
  // add_attendee produces a calendar action response — stages the change
  // on the event. The user must click Save in Calendar to persist.
  return {
    result: JSON.stringify({
      status: "calendar_action",
      attendee: args.email,
      optional: args.optional ?? false,
    }),
    isActionResponse: true,
    actionResponse: {
      renderActions: {
        action: { navigations: [] },
        hostAppAction: {
          calendarAction: {
            editAttendeesAction: {
              addAttendees: [args.email],
            },
          },
        },
      },
    },
  };
}

async function executeUpdateDescription(
  args: { description: string },
  event: WorkspaceEvent,
): Promise<ToolResult> {
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken || !event.calendar?.id) {
    return { result: JSON.stringify({ error: "Cannot update: missing context" }) };
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendar.calendarId)}/events/${encodeURIComponent(event.calendar.id)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ description: args.description }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (response.status === 403) throw new CalendarScopeError();
    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Calendar API error: ${response.status}`,
        }),
      };
    }

    return {
      result: JSON.stringify({
        success: true,
        description: args.description,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to update: ${(err as Error).message}`,
      }),
    };
  }
}

async function executeUpdateTitle(
  args: { title: string },
  event: WorkspaceEvent,
): Promise<ToolResult> {
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken || !event.calendar?.id) {
    return {
      result: JSON.stringify({ error: "Cannot update: missing context" }),
    };
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendar.calendarId)}/events/${encodeURIComponent(event.calendar.id)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        // Calendar API field is `summary` (the canonical name for "title").
        body: JSON.stringify({ summary: args.title }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (response.status === 403) throw new CalendarScopeError();
    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Calendar API error: ${response.status}`,
        }),
      };
    }

    return {
      result: JSON.stringify({ success: true, title: args.title }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to update: ${(err as Error).message}`,
      }),
    };
  }
}

async function executeGetUpcomingEvents(
  args: { maxResults?: number; timeMin?: string; timeMax?: string },
  event: WorkspaceEvent,
): Promise<ToolResult> {
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken) {
    return { result: JSON.stringify({ error: "No OAuth token available" }) };
  }

  const max = Math.min(args.maxResults ?? 10, 25);
  const timeMin = args.timeMin ?? new Date().toISOString();
  const timeMax =
    args.timeMax ??
    new Date(
      new Date(timeMin).getTime() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

  try {
    const url =
      `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
      `?maxResults=${max}` +
      `&timeMin=${encodeURIComponent(timeMin)}` +
      `&timeMax=${encodeURIComponent(timeMax)}` +
      `&singleEvents=true` +
      `&orderBy=startTime`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${oauthToken}` },
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 403) throw new CalendarScopeError();
    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Calendar API error: ${response.status}`,
        }),
      };
    }

    const data: any = await response.json();
    const events = (data.items ?? []).map((e: any) => ({
      id: e.id,
      summary: e.summary,
      start: e.start?.dateTime ?? e.start?.date,
      end: e.end?.dateTime ?? e.end?.date,
      location: e.location,
      attendees: e.attendees?.map(
        (a: any) => `${a.displayName ?? a.email} (${a.responseStatus ?? "unknown"})`,
      ),
      htmlLink: e.htmlLink,
    }));

    return {
      result: JSON.stringify({
        rangeStart: timeMin,
        rangeEnd: timeMax,
        count: events.length,
        events,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to list events: ${(err as Error).message}`,
      }),
    };
  }
}

async function executeRescheduleEvent(
  args: { start?: string; end?: string },
  event: WorkspaceEvent,
): Promise<ToolResult> {
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken || !event.calendar?.id) {
    return {
      result: JSON.stringify({
        error: "Cannot reschedule: no calendar event is open",
      }),
    };
  }

  if (!args.start && !args.end) {
    return {
      result: JSON.stringify({
        error: "At least one of start or end is required",
      }),
    };
  }

  try {
    const body: Record<string, any> = {};
    if (args.start) body.start = { dateTime: args.start };
    if (args.end) body.end = { dateTime: args.end };

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendar.calendarId)}/events/${encodeURIComponent(event.calendar.id)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (response.status === 403) throw new CalendarScopeError();
    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Calendar API error: ${response.status}`,
        }),
      };
    }

    const data: any = await response.json();
    return {
      result: JSON.stringify({
        success: true,
        start: data.start,
        end: data.end,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to reschedule: ${(err as Error).message}`,
      }),
    };
  }
}

async function executeCreateEvent(
  args: {
    summary: string;
    start: string;
    end: string;
    attendees?: string[];
    description?: string;
    location?: string;
  },
  event: WorkspaceEvent,
): Promise<ToolResult> {
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken) {
    return { result: JSON.stringify({ error: "No OAuth token available" }) };
  }

  try {
    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: args.summary,
          start: { dateTime: args.start },
          end: { dateTime: args.end },
          attendees: args.attendees?.map((email) => ({ email })),
          description: args.description,
          location: args.location,
        }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (response.status === 403) throw new CalendarScopeError();
    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Calendar API error: ${response.status}`,
        }),
      };
    }

    const data: any = await response.json();
    return {
      result: JSON.stringify({
        success: true,
        eventId: data.id,
        link: data.htmlLink,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to create event: ${(err as Error).message}`,
      }),
    };
  }
}
