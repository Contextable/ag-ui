import { markdownToHtml } from "../core/markdown-to-html";
import {
  type Card,
  section,
  card,
  textParagraph,
  decoratedText,
  buttonList,
  actionButton,
} from "./widgets";

export interface ApprovalCardOpts {
  /** Human-readable name of the tool action */
  toolName: string;
  /** Description of what the tool will do */
  description: string;
  /** Detailed parameters the agent wants to use */
  parameters: Record<string, unknown>;
  /** The tool call ID (for routing approve/reject) */
  toolCallId: string;
  /** Base URL for action endpoints (HTTP add-on requirement) */
  baseUrl?: string;
}

/**
 * Renders a HITL approval card for write tools.
 * The user must approve or reject before the action is executed.
 */
export function approvalCard(opts: ApprovalCardOpts): Card {
  const baseUrl = (opts.baseUrl ?? process.env.ACTION_BASE_URL ?? "").replace(
    /\/$/,
    "",
  );
  const paramWidgets = Object.entries(opts.parameters).map(([key, value]) => {
    const displayText =
      value === "" || value === null || value === undefined
        ? "(empty)"
        : typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2);
    return decoratedText({
      topLabel: key,
      text: displayText,
      wrapText: true,
    });
  });

  return card({
    title: "Action Required",
    sections: [
      section(undefined, [
        decoratedText({
          text: opts.toolName,
          icon: "DESCRIPTION",
          topLabel: "Action",
        }),
        textParagraph(markdownToHtml(opts.description)),
      ]),
      section("Parameters", paramWidgets),
      section(undefined, [
        buttonList(
          actionButton("Approve", `${baseUrl}/actions/approve`, {
            toolCallId: opts.toolCallId,
          }),
          actionButton("Reject", `${baseUrl}/actions/reject`, {
            toolCallId: opts.toolCallId,
          }),
        ),
      ]),
    ],
  });
}
