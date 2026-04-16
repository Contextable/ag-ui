import type { Context } from "@ag-ui/core";
import type { WorkspaceEvent } from "../../types";

/**
 * Extracts Gmail context from the workspace event.
 *
 * Google provides messageId, threadId, and an accessToken scoped to the
 * current message. Full email content must be fetched via the Gmail API
 * using the accessToken.
 */
export async function extractGmailContext(
  event: WorkspaceEvent,
): Promise<Context[]> {
  const contexts: Context[] = [
    { description: "Google Workspace host application", value: "GMAIL" },
  ];

  if (!event.gmail) {
    return contexts;
  }

  contexts.push({
    description: "Gmail message ID of the email the user is currently viewing",
    value: event.gmail.messageId,
  });

  contexts.push({
    description: "Gmail thread ID",
    value: event.gmail.threadId,
  });

  // If we have an OAuth token, attempt to fetch email metadata
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (oauthToken && event.gmail.messageId) {
    try {
      const emailContext = await fetchEmailContext(
        event.gmail.messageId,
        event.gmail.accessToken,
        oauthToken,
      );
      contexts.push(...emailContext);
    } catch (err) {
      console.error("Failed to fetch email context:", err);
      // Non-fatal — continue without email content
    }
  }

  // Compose context (if in compose mode)
  if (event.gmail.toRecipients?.length) {
    contexts.push({
      description: "Draft To recipients",
      value: event.gmail.toRecipients.join(", "),
    });
  }
  if (event.gmail.ccRecipients?.length) {
    contexts.push({
      description: "Draft CC recipients",
      value: event.gmail.ccRecipients.join(", "),
    });
  }

  return contexts;
}

/**
 * Fetches email metadata and body via the Gmail API.
 * Uses the Gmail add-on access token for scoped access to the current message.
 */
async function fetchEmailContext(
  messageId: string,
  gmailAccessToken: string,
  oauthToken: string,
): Promise<Context[]> {
  // Try `format=full` first (needs gmail.addons.current.message.readonly).
  // If the user only granted metadata scope, fall back to `format=metadata`
  // so we still get headers (subject/from/to/date) just no body.
  let response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    {
      headers: {
        Authorization: `Bearer ${oauthToken}`,
        "X-Goog-Gmail-Access-Token": gmailAccessToken,
      },
      signal: AbortSignal.timeout(5000),
    },
  );

  if (response.status === 403) {
    console.log(
      "[gmail.context] format=full returned 403, falling back to metadata-only",
    );
    response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
      {
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "X-Goog-Gmail-Access-Token": gmailAccessToken,
        },
        signal: AbortSignal.timeout(5000),
      },
    );
  }

  if (!response.ok) {
    throw new Error(`Gmail API returned ${response.status}`);
  }

  const message: any = await response.json();
  const contexts: Context[] = [];

  // Extract headers
  const headers = message.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h: { name: string }) => h.name.toLowerCase() === name.toLowerCase())?.value;

  const subject = getHeader("Subject");
  const from = getHeader("From");
  const to = getHeader("To");
  const date = getHeader("Date");

  if (subject) contexts.push({ description: "Email subject", value: subject });
  if (from) contexts.push({ description: "Email sender", value: from });
  if (to) contexts.push({ description: "Email recipients", value: to });
  if (date) contexts.push({ description: "Email date", value: date });

  // Extract body text
  const body = extractBody(message.payload);
  if (body) {
    contexts.push({
      description: "Email body content",
      value: body.slice(0, 2000), // Limit to avoid huge context
    });
  }

  return contexts;
}

/**
 * Extracts the plain text body from a Gmail message payload.
 * Handles both simple and multipart messages.
 */
function extractBody(payload: any): string | null {
  if (!payload) return null;

  // Simple message with direct body
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart — look for text/plain first, then text/html
  if (payload.parts) {
    const textPart = payload.parts.find(
      (p: any) => p.mimeType === "text/plain",
    );
    if (textPart?.body?.data) {
      return decodeBase64Url(textPart.body.data);
    }

    const htmlPart = payload.parts.find(
      (p: any) => p.mimeType === "text/html",
    );
    if (htmlPart?.body?.data) {
      // Strip HTML tags for a rough text extraction
      const html = decodeBase64Url(htmlPart.body.data);
      return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }

    // Nested multipart
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return null;
}

/**
 * Decodes base64url-encoded string (used by Gmail API).
 */
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}
