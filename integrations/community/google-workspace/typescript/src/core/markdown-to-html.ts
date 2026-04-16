/**
 * Converts markdown text to the limited HTML subset supported by
 * Google Workspace CardService TextParagraph widgets.
 *
 * Supported tags: <b>, <i>, <u>, <br>, <a href="...">, <font color="...">
 * Everything else is stripped or escaped.
 */
export function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Escape any existing HTML (except what we'll generate)
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic: *text* or _text_ (but not inside bold markers)
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<i>$1</i>");

  // Inline code: `text` -> monospace approximation (no <code> in CardService)
  html = html.replace(/`([^`]+)`/g, "<b>$1</b>");

  // Links: [text](url)
  // Allow one level of nested brackets in the link text — Gmail email
  // subjects often contain bracketed prefixes like
  // "[Re: [CopilotKit/CopilotKit] PR title]" which a naive `[^\]]+` would
  // truncate at the first `]`.
  html = html.replace(
    /\[((?:[^\[\]]|\[[^\]]*\])*)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>',
  );

  // Code blocks: ```...``` -> plain text with line breaks
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/```\w*\n?/, "").replace(/\n?```$/, "");
    return `<br>${code.replace(/\n/g, "<br>")}<br>`;
  });

  // Line breaks
  html = html.replace(/\n\n/g, "<br><br>");
  html = html.replace(/\n/g, "<br>");

  // Headers: # text -> bold text
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Bullet lists: - text or * text
  html = html.replace(/^[\-\*]\s+(.+)$/gm, "- $1");

  return html;
}

/**
 * Truncates text to a maximum length, adding an ellipsis if truncated.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}
