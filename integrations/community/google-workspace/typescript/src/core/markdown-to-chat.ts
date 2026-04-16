/**
 * Converts standard markdown to Google Chat's text formatting syntax.
 *
 * Google Chat uses a non-standard format:
 *   Bold:          *text*       (NOT **text**)
 *   Italic:        _text_       (same as markdown)
 *   Strikethrough: ~text~       (NOT ~~text~~)
 *   Monospace:     `text`       (same as markdown)
 *   Code block:    ```text```   (same as markdown)
 *   Link:          <url|text>   (NOT [text](url))
 *   Bullet list:   * item       (same as markdown)
 *
 * This function converts standard markdown → Chat format.
 */
export function markdownToChat(markdown: string): string {
  let text = markdown;

  // Preserve code blocks from being modified (use \x00 as sentinel — won't appear in text)
  const codeBlocks: string[] = [];
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // Preserve inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`[^`]+`/g, (match) => {
    inlineCodes.push(match);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // Convert * and - bullet lists to Unicode bullets BEFORE bold conversion
  // to avoid conflicts between bullet * and bold * markers
  text = text.replace(/^(\s*)\*(\s+)/gm, "$1\u2022$2");
  text = text.replace(/^(\s*)-(\s+)/gm, "$1\u2022$2");

  // Convert links: [text](url) → <url|text>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Convert bold: **text** → *text*
  // Must be done before italic to avoid conflicts
  text = text.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Convert __text__ bold → *text*
  text = text.replace(/__(.+?)__/g, "*$1*");

  // Convert strikethrough: ~~text~~ → ~text~
  text = text.replace(/~~(.+?)~~/g, "~$1~");

  // Convert headers: # text → *text* (bold)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Restore inline code
  text = text.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCodes[parseInt(i)]);

  // Restore code blocks
  text = text.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

  return text;
}
