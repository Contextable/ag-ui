import type { Context } from "@ag-ui/core";
import type { WorkspaceEvent } from "../../types";

/**
 * Extracts Calendar context from the workspace event.
 *
 * Google provides the event ID, calendar ID, organizer, attendees (if
 * currentEventAccess allows), and capabilities. Full event details
 * (summary, description, start/end, location) must be fetched via the
 * Calendar API.
 */
export async function extractCalendarContext(
  event: WorkspaceEvent,
): Promise<Context[]> {
  const contexts: Context[] = [
    { description: "Google Workspace host application", value: "CALENDAR" },
  ];

  if (!event.calendar) {
    return contexts;
  }

  contexts.push({
    description: "Calendar event ID",
    value: event.calendar.id,
  });

  if (event.calendar.calendarId) {
    contexts.push({
      description: "Calendar ID",
      value: event.calendar.calendarId,
    });
  }

  if (event.calendar.organizer?.email) {
    contexts.push({
      description: "Event organizer email",
      value: event.calendar.organizer.email,
    });
  }

  // Attendees from the event object (available with currentEventAccess: READ)
  if (event.calendar.attendees?.length) {
    const attendeeList = event.calendar.attendees
      .map(
        (a) =>
          `${a.displayName || a.email} (${a.responseStatus || "unknown"})`,
      )
      .join(", ");
    contexts.push({
      description: "Event attendees",
      value: attendeeList,
    });
  }

  // Optimistically try to fetch event details. If 403, skip silently —
  // the user gets prompted for the scope when they call a tool that needs it.
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (oauthToken && event.calendar.id && event.calendar.calendarId) {
    try {
      const details = await fetchEventDetails(
        event.calendar.calendarId,
        event.calendar.id,
        oauthToken,
      );
      contexts.push(...details);
    } catch (err) {
      console.error("Failed to fetch calendar event details:", err);
    }
  }

  return contexts;
}

async function fetchEventDetails(
  calendarId: string,
  eventId: string,
  oauthToken: string,
): Promise<Context[]> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      headers: { Authorization: `Bearer ${oauthToken}` },
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!response.ok) {
    throw new Error(`Calendar API returned ${response.status}`);
  }

  const data: any = await response.json();
  const contexts: Context[] = [];

  if (data.summary) {
    contexts.push({ description: "Event title", value: data.summary });
  }
  if (data.description) {
    contexts.push({
      description: "Event description",
      value: data.description.slice(0, 1000),
    });
  }
  if (data.start) {
    contexts.push({
      description: "Event start time",
      value: data.start.dateTime || data.start.date,
    });
  }
  if (data.end) {
    contexts.push({
      description: "Event end time",
      value: data.end.dateTime || data.end.date,
    });
  }
  if (data.location) {
    contexts.push({ description: "Event location", value: data.location });
  }
  if (data.hangoutLink) {
    contexts.push({
      description: "Conference link",
      value: data.hangoutLink,
    });
  }

  return contexts;
}
