import { markdownToHtml, truncateText } from "../core/markdown-to-html";
import {
  type Card,
  section,
  card,
  textParagraph,
  decoratedText,
  textInput,
  buttonList,
  actionButton,
  divider,
} from "./widgets";

const MAX_RESPONSE_LENGTH = 4000;

export interface ConversationCardOpts {
  /** The agent's latest response text (may be markdown) */
  agentResponse?: string;
  /** Whether the agent is still processing */
  loading?: boolean;
  /** Error message, if any */
  error?: string;
  /** Tool calls the agent executed (for display) */
  toolCalls?: Array<{ name: string; status: "completed" | "pending" }>;
  /**
   * Base URL for action endpoints. For HTTP add-ons, action button `function`
   * fields must be full URLs, not just function names.
   * Defaults to ACTION_BASE_URL env var if not provided.
   */
  baseUrl?: string;
  /** Pre-fill the message input with this text (e.g., after a consent interruption). */
  prefillMessage?: string;
}

/**
 * Renders the main conversation card shown in the Gmail/Docs sidebar.
 * Displays the agent's latest response and an input field for the user.
 */
export function conversationCard(opts: ConversationCardOpts = {}): Card {
  const widgets = [];

  // Loading state
  if (opts.loading) {
    widgets.push(
      decoratedText({
        text: "Thinking...",
        icon: "CLOCK",
      }),
    );
  }

  // Error state
  if (opts.error) {
    widgets.push(
      decoratedText({
        text: opts.error,
        icon: "DESCRIPTION",
        topLabel: "Error",
      }),
    );
  }

  // Tool calls display
  if (opts.toolCalls?.length) {
    for (const tc of opts.toolCalls) {
      const icon = tc.status === "completed" ? "CONFIRMATION_NUMBER_ICON" : "CLOCK";
      widgets.push(
        decoratedText({
          text: tc.name,
          icon,
          topLabel: "Tool",
        }),
      );
    }
  }

  // Agent response
  if (opts.agentResponse) {
    const html = markdownToHtml(
      truncateText(opts.agentResponse, MAX_RESPONSE_LENGTH),
    );
    widgets.push(
      decoratedText({ text: "Agent", icon: "PERSON" }),
    );
    widgets.push(textParagraph(html));
  }

  // If nothing to show, display welcome message
  if (!widgets.length) {
    widgets.push(
      textParagraph(
        "Welcome to AG-UI Agent. Type a message below to get started.",
      ),
    );
  }

  const responseSection = section("Response", widgets);

  const baseUrl = (opts.baseUrl ?? process.env.ACTION_BASE_URL ?? "").replace(
    /\/$/,
    "",
  );

  // Input section
  const inputSection = section("Input", [
    textInput({
      name: "user_message",
      label: "Type a message...",
      value: opts.prefillMessage,
      multiLine: true,
    }),
    buttonList(
      actionButton("Send", `${baseUrl}/actions/send`),
      actionButton("New Thread", `${baseUrl}/actions/new-thread`),
      actionButton("Settings", `${baseUrl}/actions/settings`),
    ),
  ]);

  return card({
    title: "AG-UI Agent",
    sections: [responseSection, inputSection],
  });
}
