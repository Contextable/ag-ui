import { describe, it, expect } from "vitest";
import { markdownToChat } from "../../src/core/markdown-to-chat";

describe("markdownToChat", () => {
  it("converts **bold** to *bold*", () => {
    expect(markdownToChat("**hello**")).toBe("*hello*");
  });

  it("converts __bold__ to *bold*", () => {
    expect(markdownToChat("__hello__")).toBe("*hello*");
  });

  it("leaves _italic_ unchanged", () => {
    expect(markdownToChat("_hello_")).toBe("_hello_");
  });

  it("converts ~~strikethrough~~ to ~strikethrough~", () => {
    expect(markdownToChat("~~deleted~~")).toBe("~deleted~");
  });

  it("converts [text](url) to <url|text>", () => {
    expect(markdownToChat("[click here](https://example.com)")).toBe(
      "<https://example.com|click here>",
    );
  });

  it("converts headers to bold", () => {
    expect(markdownToChat("# Title")).toBe("*Title*");
    expect(markdownToChat("## Subtitle")).toBe("*Subtitle*");
    expect(markdownToChat("### H3")).toBe("*H3*");
  });

  it("preserves inline code", () => {
    expect(markdownToChat("use `**bold**` syntax")).toBe(
      "use `**bold**` syntax",
    );
  });

  it("preserves code blocks", () => {
    const input = "text\n```\n**not bold**\n```\nmore text";
    const result = markdownToChat(input);
    // Code blocks pass through to Chat unchanged — Chat natively supports ```
    expect(result).toContain("```");
    expect(result).toContain("**not bold**");
  });

  it("handles mixed formatting", () => {
    expect(markdownToChat("**bold** and _italic_ and ~~strike~~")).toBe(
      "*bold* and _italic_ and ~strike~",
    );
  });

  it("converts * bullets to unicode bullets", () => {
    expect(markdownToChat("* item 1\n* item 2")).toBe("\u2022 item 1\n\u2022 item 2");
  });

  it("converts - bullets to unicode bullets", () => {
    expect(markdownToChat("- item 1\n- item 2")).toBe("\u2022 item 1\n\u2022 item 2");
  });

  it("handles bullet + bold combo correctly", () => {
    const input = "*   **Easy Train Travel:** Vienna is great";
    const result = markdownToChat(input);
    expect(result).toBe("\u2022   *Easy Train Travel:* Vienna is great");
  });

  it("leaves plain text unchanged", () => {
    expect(markdownToChat("just plain text")).toBe("just plain text");
  });
});
