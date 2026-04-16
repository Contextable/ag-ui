import type { Context } from "@ag-ui/core";
import type { WorkspaceEvent } from "../../types";

/**
 * Extracts Chat context from the workspace event.
 *
 * Google Chat events include the message text, user info, space, and thread
 * directly in the payload — no API call needed.
 */
export function extractChatContext(event: WorkspaceEvent): Context[] {
  const contexts: Context[] = [
    { description: "Google Workspace host application", value: "CHAT" },
  ];

  if (!event.chat) {
    return contexts;
  }

  const messageText = event.chat.messagePayload?.message?.text;
  if (messageText) {
    contexts.push({
      description: "User's chat message",
      value: messageText,
    });
  }

  if (event.chat.user?.displayName) {
    contexts.push({
      description: "Chat user display name",
      value: event.chat.user.displayName,
    });
  }

  if (event.chat.user?.email) {
    contexts.push({
      description: "Chat user email",
      value: event.chat.user.email,
    });
  }

  if (event.chat.space?.name) {
    contexts.push({
      description: "Chat space",
      value: event.chat.space.name,
    });
  }

  if (event.chat.space?.type) {
    contexts.push({
      description: "Chat space type",
      value: event.chat.space.type,
    });
  }

  return contexts;
}
