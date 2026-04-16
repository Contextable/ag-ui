import { describe, it, expect } from "vitest";
import {
  markdownToHtml,
  truncateText,
} from "../../src/core/markdown-to-html";

describe("markdownToHtml", () => {
  it("converts bold markdown", () => {
    expect(markdownToHtml("**bold**")).toBe("<b>bold</b>");
    expect(markdownToHtml("__bold__")).toBe("<b>bold</b>");
  });

  it("converts italic markdown", () => {
    expect(markdownToHtml("*italic*")).toBe("<i>italic</i>");
  });

  it("converts links", () => {
    const result = markdownToHtml("[click here](https://example.com)");
    expect(result).toBe('<a href="https://example.com">click here</a>');
  });

  it("handles links with nested brackets in text (e.g., email subjects)", () => {
    const result = markdownToHtml(
      "[Re: [CopilotKit/CopilotKit] PR title](https://mail.google.com/abc123)",
    );
    expect(result).toBe(
      '<a href="https://mail.google.com/abc123">Re: [CopilotKit/CopilotKit] PR title</a>',
    );
  });

  it("converts inline code to bold", () => {
    expect(markdownToHtml("`code`")).toBe("<b>code</b>");
  });

  it("converts line breaks", () => {
    expect(markdownToHtml("line1\n\nline2")).toBe("line1<br><br>line2");
  });

  it("escapes HTML in input", () => {
    const result = markdownToHtml("<script>alert('xss')</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("handles plain text without modification", () => {
    expect(markdownToHtml("plain text")).toBe("plain text");
  });
});

describe("truncateText", () => {
  it("returns short text unchanged", () => {
    expect(truncateText("short", 100)).toBe("short");
  });

  it("truncates long text with ellipsis", () => {
    const result = truncateText("a".repeat(100), 50);
    expect(result.length).toBe(50);
    expect(result.endsWith("...")).toBe(true);
  });

  it("returns exact-length text unchanged", () => {
    expect(truncateText("12345", 5)).toBe("12345");
  });
});
