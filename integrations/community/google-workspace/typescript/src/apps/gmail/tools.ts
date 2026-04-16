import type { Tool, ToolCall } from "@ag-ui/core";
import type { WorkspaceEvent, ToolResult } from "../../types";

/** Marker for tools that produce a ComposeActionResponse */
const COMPOSE_ACTION_MARKER = "__COMPOSE_ACTION__";

/**
 * Returns the set of Gmail tools injected into RunAgentInput.
 * The agent sees these as abstract tools — it doesn't know about Gmail APIs.
 */
export function getGmailTools(_event: WorkspaceEvent): Tool[] {
  return [
    {
      name: "read_current_email",
      description:
        "Read the full contents of the email the user is currently viewing in Gmail, including subject, sender, recipients, date, and body.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "draft_reply",
      description:
        "Draft a reply to the current email. Opens Gmail's compose window for the user to review and send. The user can edit the reply before sending.",
      parameters: {
        type: "object",
        properties: {
          body: {
            type: "string",
            description: "The reply body text (plain text or HTML)",
          },
          cc: {
            type: "array",
            items: { type: "string" },
            description: "CC recipients (optional)",
          },
        },
        required: ["body"],
      },
    },
    {
      name: "search_inbox",
      description:
        "Search the user's Gmail inbox. Uses the same query syntax as the Gmail search bar (e.g., 'from:alice subject:meeting after:2026/01/01').",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Gmail search query (same syntax as Gmail search bar)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "read_emails",
      description:
        "Fetch the full contents of one or more emails by their message IDs (typically returned by search_inbox). Use this to summarize, answer questions about, or quote specific emails.",
      parameters: {
        type: "object",
        properties: {
          messageIds: {
            type: "array",
            items: { type: "string" },
            description: "Gmail message IDs to fetch (max 10 per call).",
          },
        },
        required: ["messageIds"],
      },
    },
  ];
}

/**
 * Categorizes Gmail tools by their read/write nature.
 */
export function isGmailWriteTool(toolName: string): boolean {
  return toolName === "draft_reply";
}

/**
 * Executes a Gmail client-side tool call.
 * Returns null if the tool is not a Gmail tool.
 */
export async function executeGmailTool(
  toolCall: ToolCall,
  event: WorkspaceEvent,
): Promise<ToolResult | null> {
  const name = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments || "{}");

  switch (name) {
    case "read_current_email":
      return executeReadCurrentEmail(event);

    case "draft_reply":
      return executeDraftReply(args, event);

    case "search_inbox":
      return executeSearchInbox(args, event);

    case "read_emails":
      return executeReadEmails(args, event);

    default:
      return null;
  }
}

async function executeReadCurrentEmail(
  event: WorkspaceEvent,
): Promise<ToolResult> {
  if (!event.gmail?.messageId) {
    return {
      result: JSON.stringify({
        error: "No email is currently open",
      }),
    };
  }

  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken) {
    return {
      result: JSON.stringify({
        error: "No OAuth token available to read email",
      }),
    };
  }

  try {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${event.gmail.messageId}?format=full`,
      {
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "X-Goog-Gmail-Access-Token": event.gmail.accessToken,
        },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Gmail API error: ${response.status}`,
        }),
      };
    }

    const message: any = await response.json();
    const headers = message.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find(
        (h: { name: string }) =>
          h.name.toLowerCase() === name.toLowerCase(),
      )?.value;

    const body = extractPlainBody(message.payload);

    return {
      result: JSON.stringify({
        subject: getHeader("Subject"),
        from: getHeader("From"),
        to: getHeader("To"),
        cc: getHeader("Cc"),
        date: getHeader("Date"),
        body: body?.slice(0, 4000) ?? "(no body)",
        snippet: message.snippet,
        labels: message.labelIds,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to read email: ${(err as Error).message}`,
      }),
    };
  }
}

async function executeDraftReply(
  args: { body: string; cc?: string[] },
  event: WorkspaceEvent,
): Promise<ToolResult> {
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken || !event.gmail?.messageId) {
    return {
      result: JSON.stringify({
        error: "Cannot draft reply: missing OAuth token or message ID",
      }),
    };
  }

  // Scope is checked optimistically — if the API returns 403, we return
  // a consent response below.

  try {
    // First, fetch the original message to get headers we need for the reply
    const origResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${event.gmail.messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Message-ID&metadataHeaders=References`,
      {
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "X-Goog-Gmail-Access-Token": event.gmail.accessToken,
        },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!origResponse.ok) {
      return {
        result: JSON.stringify({
          error: `Failed to read original email: HTTP ${origResponse.status}`,
        }),
      };
    }

    const origMessage: any = await origResponse.json();
    const headers = origMessage.payload?.headers ?? [];
    const getHeader = (name: string): string | undefined =>
      headers.find(
        (h: { name: string }) => h.name.toLowerCase() === name.toLowerCase(),
      )?.value;

    const origFrom = getHeader("From") ?? "";
    const origSubject = getHeader("Subject") ?? "";
    const origMessageId = getHeader("Message-ID") ?? "";
    const origReferences = getHeader("References") ?? "";

    // Build the reply subject (prepend "Re: " if not already present)
    const replySubject = origSubject.toLowerCase().startsWith("re:")
      ? origSubject
      : `Re: ${origSubject}`;

    // Build References header (chain of message IDs in the thread)
    const newReferences = origReferences
      ? `${origReferences} ${origMessageId}`.trim()
      : origMessageId;

    // Build the raw RFC 2822 message
    const headerLines = [
      `To: ${origFrom}`,
      ...(args.cc?.length ? [`Cc: ${args.cc.join(", ")}`] : []),
      `Subject: ${replySubject}`,
      ...(origMessageId ? [`In-Reply-To: ${origMessageId}`] : []),
      ...(newReferences ? [`References: ${newReferences}`] : []),
      "Content-Type: text/plain; charset=UTF-8",
      "MIME-Version: 1.0",
    ];
    const rawMessage = `${headerLines.join("\r\n")}\r\n\r\n${args.body}`;
    // Encode as base64url (RFC 4648)
    const encodedMessage = Buffer.from(rawMessage, "utf-8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // Create the draft as a reply in the same thread
    const draftResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            raw: encodedMessage,
            threadId: event.gmail.threadId,
          },
        }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (draftResponse.status === 403) {
      return {
        result: JSON.stringify({ status: "missing_scope" }),
        isActionResponse: true,
        actionResponse: {
          requesting_google_scopes: {
            scopes: ["https://www.googleapis.com/auth/gmail.compose"],
          },
        },
      };
    }
    if (!draftResponse.ok) {
      const errorText = await draftResponse.text();
      return {
        result: JSON.stringify({
          error: `Failed to create draft: HTTP ${draftResponse.status} ${errorText.slice(0, 200)}`,
        }),
      };
    }

    const draft: any = await draftResponse.json();

    // Return a hostAppAction response that opens the compose window with
    // the newly-created draft.
    //
    // Schema notes:
    //   - The response is parsed as google.apps.card.v1.RenderActions
    //     DIRECTLY — do NOT wrap in another `renderActions` field.
    //   - Inside hostAppAction.gmailAction (apps.extensions.markup.GmailClientActionMarkup),
    //     the field is `openCreatedDraftActionMarkup` — note the `Markup`
    //     suffix. Field name `openCreatedDraftAction` does NOT exist.
    //   - The draftId for the markup must include the `r` prefix that
    //     Gmail uses internally. The Gmail API returns IDs like "r1234..."
    //     directly, so we can pass `draft.id` as-is.
    // The draft response includes the draft's id and message.threadId in
    // hex format (e.g. "15e9fa622ce1029d"), which is what the markup
    // expects. The addon event's `thread-f:1862...` format is rejected.
    const draftThreadId = draft.message?.threadId;
    console.log(
      `[draft_reply] draft.id=${draft.id} draft.message.threadId=${draftThreadId}`,
    );

    return {
      result: JSON.stringify({
        status: "draft_created",
        draftId: draft.id,
        threadId: draftThreadId,
        to: origFrom,
        subject: replySubject,
      }),
      isActionResponse: true,
      actionResponse: {
        hostAppAction: {
          gmailAction: {
            openCreatedDraftActionMarkup: {
              draftId: draft.id,
              ...(draftThreadId ? { draftThreadId } : {}),
            },
          },
        },
      },
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to draft reply: ${(err as Error).message}`,
      }),
    };
  }
}

async function executeSearchInbox(
  args: { query: string },
  event: WorkspaceEvent,
): Promise<ToolResult> {
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken) {
    return {
      result: JSON.stringify({ error: "No OAuth token available" }),
    };
  }

  try {
    // List matching messages
    const listResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(args.query)}&maxResults=5`,
      {
        headers: { Authorization: `Bearer ${oauthToken}` },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!listResponse.ok) {
      return {
        result: JSON.stringify({
          error: `Gmail API error: ${listResponse.status}`,
        }),
      };
    }

    const listData: any = await listResponse.json();
    const messages = listData.messages ?? [];

    if (messages.length === 0) {
      return {
        result: JSON.stringify({ results: [], message: "No matching emails found" }),
      };
    }

    // Fetch snippets for each result
    const results = await Promise.all(
      messages.slice(0, 5).map(async (msg: { id: string }) => {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          {
            headers: { Authorization: `Bearer ${oauthToken}` },
            signal: AbortSignal.timeout(5000),
          },
        );
        if (!res.ok) return { id: msg.id, error: `HTTP ${res.status}` };
        const data: any = await res.json();
        const headers = data.payload?.headers ?? [];
        const getHeader = (name: string) =>
          headers.find(
            (h: { name: string }) =>
              h.name.toLowerCase() === name.toLowerCase(),
          )?.value;
        return {
          id: msg.id,
          subject: getHeader("Subject"),
          from: getHeader("From"),
          date: getHeader("Date"),
          snippet: data.snippet,
        };
      }),
    );

    return { result: JSON.stringify({ results }) };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Search failed: ${(err as Error).message}`,
      }),
    };
  }
}

const READ_EMAILS_MAX_IDS = 10;
const READ_EMAILS_PER_BODY_CAP = 3000;
const READ_EMAILS_TOTAL_CAP = 8000;

async function executeReadEmails(
  args: { messageIds: string[] },
  event: WorkspaceEvent,
): Promise<ToolResult> {
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken) {
    return {
      result: JSON.stringify({ error: "No OAuth token available" }),
    };
  }

  const ids = (args.messageIds || []).slice(0, READ_EMAILS_MAX_IDS);
  if (ids.length === 0) {
    return {
      result: JSON.stringify({
        error: "messageIds is required and must contain at least one ID",
      }),
    };
  }

  const fetchOne = async (id: string) => {
    try {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        {
          headers: { Authorization: `Bearer ${oauthToken}` },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!res.ok) {
        return { id, error: `Gmail API error: ${res.status}` };
      }
      const message: any = await res.json();
      const headers = message.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find(
          (h: { name: string }) =>
            h.name.toLowerCase() === name.toLowerCase(),
        )?.value;
      const body = extractPlainBody(message.payload) ?? "";
      return {
        id,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        to: getHeader("To"),
        date: getHeader("Date"),
        snippet: message.snippet,
        body: body.slice(0, READ_EMAILS_PER_BODY_CAP),
      };
    } catch (err) {
      return { id, error: `Fetch failed: ${(err as Error).message}` };
    }
  };

  const results = await Promise.all(ids.map(fetchOne));

  // Cap total response size by truncating later messages' bodies if needed.
  let runningTotal = 0;
  for (const r of results) {
    if (!("body" in r) || typeof r.body !== "string") continue;
    if (runningTotal + r.body.length <= READ_EMAILS_TOTAL_CAP) {
      runningTotal += r.body.length;
      continue;
    }
    const remaining = Math.max(0, READ_EMAILS_TOTAL_CAP - runningTotal);
    r.body =
      remaining > 0
        ? r.body.slice(0, remaining) + "... [truncated for context size]"
        : "[body omitted to fit context size]";
    runningTotal = READ_EMAILS_TOTAL_CAP;
  }

  return { result: JSON.stringify({ results }) };
}

/**
 * Extracts plain text body from a Gmail message payload.
 */
function extractPlainBody(payload: any): string | null {
  if (!payload) return null;

  if (payload.body?.data) {
    return Buffer.from(
      payload.body.data.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf-8");
  }

  if (payload.parts) {
    const textPart = payload.parts.find(
      (p: any) => p.mimeType === "text/plain",
    );
    if (textPart?.body?.data) {
      return Buffer.from(
        textPart.body.data.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf-8");
    }
    for (const part of payload.parts) {
      const nested = extractPlainBody(part);
      if (nested) return nested;
    }
  }

  return null;
}
