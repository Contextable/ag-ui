import type { Context, Tool, ToolCall } from "@ag-ui/core";

/**
 * Workspace event object received from Google on every HTTP POST.
 * Contains trigger context, user identity, and host-app-specific data.
 */
export interface WorkspaceEvent {
  /** Common fields present on every event */
  commonEventObject: {
    userLocale: string;
    hostApp: HostApp;
    platform: "WEB" | "ANDROID" | "IOS";
    timeZone?: { id: string; offset?: number };
    parameters?: Record<string, string>;
    formInputs?: Record<string, { stringInputs?: { value: string[] } }>;
  };

  /** Authorization context (bearer token, user ID token) */
  authorizationEventObject?: {
    userOAuthToken: string;
    userIdToken: string;
    systemIdToken: string;
  };

  /** Gmail-specific fields */
  gmail?: {
    messageId: string;
    threadId: string;
    accessToken: string;
    toRecipients?: string[];
    ccRecipients?: string[];
    bccRecipients?: string[];
  };

  /** Calendar-specific fields */
  calendar?: {
    id: string;
    calendarId: string;
    organizer?: { email: string };
    attendees?: Array<{
      email: string;
      displayName?: string;
      responseStatus?: string;
    }>;
    conferenceData?: Record<string, unknown>;
    capabilities?: CalendarCapabilities;
  };

  /** Docs-specific fields */
  docs?: {
    id: string;
    title?: string;
    addonHasFileScopePermission?: boolean;
  };

  /** Chat-specific fields */
  chat?: {
    messagePayload?: {
      message?: {
        text: string;
        name: string;
        thread?: { name: string };
      };
    };
    user?: { name: string; displayName: string; email: string };
    space?: { name: string; type: string };
  };
}

export interface CalendarCapabilities {
  canAddAttendees?: boolean;
  canSeeAttendees?: boolean;
  canSeeConferenceData?: boolean;
  canSetConferenceData?: boolean;
}

export type HostApp = "GMAIL" | "CALENDAR" | "DOCS" | "CHAT";

/**
 * Lightweight session stored in Firestore.
 * Messages and agent state are owned by the backend — we only store reconnection metadata.
 */
export interface Session {
  threadId: string;
  backendUrl: string;
  credentials?: {
    token: string;
    type: "bearer" | "api-key";
  };
  hostApp: HostApp;
  createdAt: number;
  updatedAt: number;
  /**
   * Snapshot of the host-app context captured at the time of the
   * trigger (e.g., contextual / file-scope-granted). `/actions/send` and
   * other card actions don't include the original trigger context, so we
   * restore it from here for the duration of the conversation.
   */
  hostAppContext?: {
    docs?: {
      id?: string;
      title?: string;
      addonHasFileScopePermission?: boolean;
    };
  };
  /**
   * User message that was in-flight when a file-scope consent or other
   * interrupting action response fired. Stored so it can be pre-filled
   * in the input when the user returns to the sidebar after consent.
   */
  pendingUserMessage?: string;
  /**
   * A tool result we owe the agent — captured when an action-response tool
   * (e.g., draft_reply, add_attendee) was approved and executed. The action
   * response was returned to Google, so the card flow ended there. The
   * next time the user sends a message, we prepend this tool result so the
   * agent sees its previously-emitted tool call as resolved.
   */
  pendingToolResult?: {
    toolCallId: string;
    content: string;
  };
  /** Pending HITL tool call awaiting user approval */
  pendingToolCall?: {
    toolCallId: string;
    toolName: string;
    arguments: string;
    /**
     * Snapshot of host-app context at the time the tool call was created.
     * Card-action events (Approve/Reject) don't include the original
     * trigger context (e.g., gmail.messageId), so we capture it here so
     * the tool executor can restore it.
     */
    gmailContext?: {
      messageId?: string;
      threadId?: string;
      accessToken?: string;
    };
    calendarContext?: {
      id?: string;
      calendarId?: string;
    };
    docsContext?: {
      id?: string;
    };
  };
}

/**
 * Per-user configuration stored in Firestore.
 */
export interface UserConfig {
  backendUrl?: string;
  authToken?: string;
  authType?: "bearer" | "api-key";
}

/**
 * Result of a client-side tool execution.
 */
export interface ToolResult {
  /** The tool call result as a string (JSON-serialized) */
  result: string;
  /**
   * If true, this tool produces a card action response (e.g., ComposeActionResponse)
   * that terminates the current card interaction.
   */
  isActionResponse?: boolean;
  /** The action response card JSON, if isActionResponse is true */
  actionResponse?: Record<string, unknown>;
}

/**
 * Interface that each host app module must implement.
 */
export interface HostAppModule {
  hostApp: HostApp;

  /** Extract contextual information from the Google event object */
  extractContext(event: WorkspaceEvent): Promise<Context[]>;

  /** Generate tool definitions based on current context and capabilities */
  getTools(event: WorkspaceEvent): Tool[];

  /**
   * Execute a client-side tool call, returning the result.
   * Returns null if the tool is not owned by this module.
   */
  executeTool(
    toolCall: ToolCall,
    event: WorkspaceEvent,
  ): Promise<ToolResult | null>;

  /** Register host-app-specific routes */
  registerRoutes(app: HonoApp): void;
}

/** Hono app type (kept loose to avoid coupling to Hono internals) */
export type HonoApp = {
  get: (...args: unknown[]) => unknown;
  post: (...args: unknown[]) => unknown;
  route: (...args: unknown[]) => unknown;
};
