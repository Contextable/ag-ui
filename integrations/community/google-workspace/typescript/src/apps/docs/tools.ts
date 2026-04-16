import type { Tool, ToolCall } from "@ag-ui/core";
import type { WorkspaceEvent, ToolResult } from "../../types";

/**
 * Returns the file-scope consent action response. Used when an API call
 * returns 403 (no per-file access) or when we don't have the doc ID yet
 * (Google strips it from card-action events before the user grants access).
 */
function fileScopeConsentResponse(): ToolResult {
  return {
    result: JSON.stringify({ status: "requesting_file_scope" }),
    isActionResponse: true,
    actionResponse: {
      hostAppAction: {
        editorAction: {
          requestFileScopeForActiveDocument: {},
        },
      },
    },
  };
}

export function getDocsTools(event: WorkspaceEvent): Tool[] {
  const tools: Tool[] = [
    {
      name: "read_document",
      description:
        "Read the full text content of the Google Doc the user currently has open.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "get_document_outline",
      description:
        "Get the outline (heading structure) of the current document. Returns a list of headings with their level (1-6) and text. Useful for navigating large docs or before calling insert_after_text to find a section anchor.",
      parameters: { type: "object", properties: {} },
    },
  ];

  // Write tools only available if we have file scope permission
  if (event.docs?.addonHasFileScopePermission) {
    tools.push(
      {
        name: "insert_text",
        description:
          "Insert text at the end of the current document.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The text to insert",
            },
          },
          required: ["text"],
        },
      },
      {
        name: "replace_text",
        description:
          "Find and replace text in the current document. All occurrences will be replaced.",
        parameters: {
          type: "object",
          properties: {
            find: {
              type: "string",
              description: "The text to find",
            },
            replace: {
              type: "string",
              description: "The replacement text",
            },
          },
          required: ["find", "replace"],
        },
      },
      {
        name: "insert_after_text",
        description:
          "Find a text anchor in the document and insert new content directly after it. Use this to place content in a specific location (e.g., after a heading or paragraph) when you don't want to append to the very end.",
        parameters: {
          type: "object",
          properties: {
            anchor: {
              type: "string",
              description:
                "Existing text in the document to insert after (must match exactly, case-sensitive). The first occurrence is used.",
            },
            content: {
              type: "string",
              description:
                "The text to insert. Include leading/trailing newlines as needed for paragraph breaks.",
            },
          },
          required: ["anchor", "content"],
        },
      },
      {
        name: "apply_text_format",
        description:
          "Find specific text in the document and apply formatting to it (bold, italic, underline, or change to a heading level). All occurrences of the text are formatted.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The text to format (must match exactly).",
            },
            bold: { type: "boolean", description: "Apply bold (true/false)" },
            italic: {
              type: "boolean",
              description: "Apply italic (true/false)",
            },
            underline: {
              type: "boolean",
              description: "Apply underline (true/false)",
            },
            headingLevel: {
              type: "number",
              description:
                "Convert containing paragraph to a heading (1-6). Omit for inline formatting only.",
            },
          },
          required: ["text"],
        },
      },
      {
        name: "create_bulleted_list",
        description:
          "Insert a bulleted list at the end of the document, or right after a specified anchor. Each item becomes its own bullet line.",
        parameters: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: { type: "string" },
              description: "List items, in order. Each becomes one bullet.",
            },
            anchor: {
              type: "string",
              description:
                "Optional: existing text to insert after. If omitted, the list is appended to the end of the document.",
            },
          },
          required: ["items"],
        },
      },
    );
  }

  return tools;
}

export function isDocsWriteTool(toolName: string): boolean {
  return [
    "insert_text",
    "replace_text",
    "insert_after_text",
    "apply_text_format",
    "create_bulleted_list",
  ].includes(toolName);
}

export async function executeDocsTool(
  toolCall: ToolCall,
  event: WorkspaceEvent,
): Promise<ToolResult | null> {
  const name = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments || "{}");

  // Wrap every Docs tool with withFileScopeFallback so that a 403 from
  // the Docs API automatically triggers the per-file consent prompt
  // instead of returning an error.
  let executor: (() => Promise<ToolResult>) | null = null;
  switch (name) {
    case "read_document":
      executor = () => executeReadDocument(event);
      break;
    case "get_document_outline":
      executor = () => executeGetOutline(event);
      break;
    case "insert_text":
      executor = () => executeInsertText(args, event);
      break;
    case "replace_text":
      executor = () => executeReplaceText(args, event);
      break;
    case "insert_after_text":
      executor = () => executeInsertAfterText(args, event);
      break;
    case "apply_text_format":
      executor = () => executeApplyFormat(args, event);
      break;
    case "create_bulleted_list":
      executor = () => executeCreateBulletedList(args, event);
      break;
    default:
      return null;
  }
  return withFileScopeFallback(executor);
}

async function executeReadDocument(
  event: WorkspaceEvent,
): Promise<ToolResult> {
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken || !event.docs?.id) {
    return fileScopeConsentResponse();
  }

  try {
    const response = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(event.docs.id)}`,
      {
        headers: { Authorization: `Bearer ${oauthToken}` },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Docs API error: ${response.status}`,
        }),
      };
    }

    const doc: any = await response.json();
    const text = extractPlainText(doc.body);

    return {
      result: JSON.stringify({
        title: doc.title,
        content: text.slice(0, 8000),
        documentId: doc.documentId,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to read document: ${(err as Error).message}`,
      }),
    };
  }
}

async function executeInsertText(
  args: { text: string },
  event: WorkspaceEvent,
): Promise<ToolResult> {

  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken || !event.docs?.id) {
    throw new DocsFileScopeError();
  }

  try {
    const response = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(event.docs.id)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                endOfSegmentLocation: { segmentId: "" },
                text: args.text,
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Docs API error: ${response.status}`,
        }),
      };
    }

    return {
      result: JSON.stringify({ success: true, inserted: args.text.length }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to insert text: ${(err as Error).message}`,
      }),
    };
  }
}

async function executeReplaceText(
  args: { find: string; replace: string },
  event: WorkspaceEvent,
): Promise<ToolResult> {

  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken || !event.docs?.id) {
    throw new DocsFileScopeError();
  }

  try {
    const response = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(event.docs.id)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              replaceAllText: {
                containsText: {
                  text: args.find,
                  matchCase: true,
                },
                replaceText: args.replace,
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Docs API error: ${response.status}`,
        }),
      };
    }

    const data: any = await response.json();
    const occurrences =
      data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;

    return {
      result: JSON.stringify({
        success: true,
        occurrencesChanged: occurrences,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to replace text: ${(err as Error).message}`,
      }),
    };
  }
}

function extractPlainText(body: any): string {
  if (!body?.content) return "";
  const parts: string[] = [];
  for (const element of body.content) {
    if (element.paragraph?.elements) {
      for (const textElement of element.paragraph.elements) {
        if (textElement.textRun?.content) {
          parts.push(textElement.textRun.content);
        }
      }
    }
  }
  return parts.join("");
}

// ── New executors: outline, insert_after_text, apply_text_format, create_bulleted_list ──

/**
 * Fetches the doc and returns the parsed body content. Caller handles errors.
 */
class DocsFileScopeError extends Error {
  constructor() {
    super("File scope not granted");
    this.name = "DocsFileScopeError";
  }
}

async function fetchDoc(docId: string, oauthToken: string): Promise<any> {
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`,
    {
      headers: { Authorization: `Bearer ${oauthToken}` },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (res.status === 403) throw new DocsFileScopeError();
  if (!res.ok) throw new Error(`Docs API error: ${res.status}`);
  return res.json();
}

async function docsBatchUpdate(
  docId: string,
  oauthToken: string,
  requests: any[],
): Promise<any> {
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${oauthToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(5000),
    },
  );
  if (res.status === 403) throw new DocsFileScopeError();
  if (!res.ok) throw new Error(`Docs API error: ${res.status}`);
  return res.json();
}

/**
 * Wraps a tool executor so that DocsFileScopeError returns the consent
 * action instead of an error message.
 */
function withFileScopeFallback(
  fn: () => Promise<ToolResult>,
): Promise<ToolResult> {
  return fn().catch((err) => {
    if (err instanceof DocsFileScopeError) return fileScopeConsentResponse();
    return {
      result: JSON.stringify({
        error: `Docs error: ${err.message}`,
      }),
    };
  });
}

/**
 * Walks the doc body and returns the structural index of the first character
 * of `anchor` (or null if not found). Also returns the index immediately
 * after the anchor (useful for insert_after).
 */
function findTextRange(
  body: any,
  needle: string,
): { startIndex: number; endIndex: number } | null {
  if (!body?.content || !needle) return null;
  for (const element of body.content) {
    if (!element.paragraph?.elements) continue;
    for (const textElement of element.paragraph.elements) {
      const content: string | undefined = textElement.textRun?.content;
      if (!content) continue;
      const startIndex: number = textElement.startIndex ?? 0;
      const idx = content.indexOf(needle);
      if (idx !== -1) {
        return {
          startIndex: startIndex + idx,
          endIndex: startIndex + idx + needle.length,
        };
      }
    }
  }
  return null;
}

async function executeGetOutline(event: WorkspaceEvent): Promise<ToolResult> {

  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken || !event.docs?.id) {
    throw new DocsFileScopeError();
  }

  try {
    const doc = await fetchDoc(event.docs.id, oauthToken);
    const headings: Array<{ level: number; text: string; index: number }> = [];
    const HEADING_LEVELS: Record<string, number> = {
      HEADING_1: 1,
      HEADING_2: 2,
      HEADING_3: 3,
      HEADING_4: 4,
      HEADING_5: 5,
      HEADING_6: 6,
      TITLE: 0,
    };

    for (const element of doc.body?.content ?? []) {
      const paragraph = element.paragraph;
      if (!paragraph) continue;
      const styleType = paragraph.paragraphStyle?.namedStyleType;
      if (!styleType || !(styleType in HEADING_LEVELS)) continue;
      const text = (paragraph.elements ?? [])
        .map((e: any) => e.textRun?.content ?? "")
        .join("")
        .trim();
      if (!text) continue;
      headings.push({
        level: HEADING_LEVELS[styleType],
        text,
        index: element.startIndex ?? 0,
      });
    }

    return {
      result: JSON.stringify({
        title: doc.title,
        headingCount: headings.length,
        headings,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to get outline: ${(err as Error).message}`,
      }),
    };
  }
}

async function executeInsertAfterText(
  args: { anchor: string; content: string },
  event: WorkspaceEvent,
): Promise<ToolResult> {

  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken || !event.docs?.id) {
    throw new DocsFileScopeError();
  }
  if (!args.anchor || !args.content) {
    return {
      result: JSON.stringify({
        error: "Both anchor and content are required",
      }),
    };
  }

  try {
    const doc = await fetchDoc(event.docs.id, oauthToken);
    const range = findTextRange(doc.body, args.anchor);
    if (!range) {
      return {
        result: JSON.stringify({
          error: `Anchor text not found in document: "${args.anchor.slice(0, 80)}"`,
        }),
      };
    }

    const response = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(event.docs.id)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: range.endIndex },
                text: args.content,
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Docs API error: ${response.status}`,
        }),
      };
    }

    return {
      result: JSON.stringify({
        success: true,
        insertedAfter: args.anchor.slice(0, 80),
        chars: args.content.length,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to insert: ${(err as Error).message}`,
      }),
    };
  }
}

async function executeApplyFormat(
  args: {
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    headingLevel?: number;
  },
  event: WorkspaceEvent,
): Promise<ToolResult> {

  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken || !event.docs?.id) {
    throw new DocsFileScopeError();
  }
  if (!args.text) {
    return { result: JSON.stringify({ error: "text is required" }) };
  }

  try {
    const doc = await fetchDoc(event.docs.id, oauthToken);
    // Find ALL occurrences (walk body and collect ranges).
    const ranges: Array<{ startIndex: number; endIndex: number }> = [];
    for (const element of doc.body?.content ?? []) {
      if (!element.paragraph?.elements) continue;
      for (const te of element.paragraph.elements) {
        const content: string | undefined = te.textRun?.content;
        if (!content) continue;
        const start: number = te.startIndex ?? 0;
        let from = 0;
        while (true) {
          const idx = content.indexOf(args.text, from);
          if (idx === -1) break;
          ranges.push({
            startIndex: start + idx,
            endIndex: start + idx + args.text.length,
          });
          from = idx + args.text.length;
        }
      }
    }

    if (ranges.length === 0) {
      return {
        result: JSON.stringify({
          error: `Text not found in document: "${args.text.slice(0, 80)}"`,
        }),
      };
    }

    const requests: any[] = [];
    const textStyle: Record<string, boolean> = {};
    const styleFields: string[] = [];
    if (args.bold !== undefined) {
      textStyle.bold = args.bold;
      styleFields.push("bold");
    }
    if (args.italic !== undefined) {
      textStyle.italic = args.italic;
      styleFields.push("italic");
    }
    if (args.underline !== undefined) {
      textStyle.underline = args.underline;
      styleFields.push("underline");
    }

    for (const range of ranges) {
      if (styleFields.length > 0) {
        requests.push({
          updateTextStyle: {
            range,
            textStyle,
            fields: styleFields.join(","),
          },
        });
      }
      if (args.headingLevel) {
        const namedStyleType =
          args.headingLevel === 1 ? "TITLE" : `HEADING_${args.headingLevel}`;
        requests.push({
          updateParagraphStyle: {
            range,
            paragraphStyle: { namedStyleType },
            fields: "namedStyleType",
          },
        });
      }
    }

    if (requests.length === 0) {
      return {
        result: JSON.stringify({
          error:
            "At least one formatting option (bold, italic, underline, headingLevel) is required",
        }),
      };
    }

    const response = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(event.docs.id)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Docs API error: ${response.status}`,
        }),
      };
    }

    return {
      result: JSON.stringify({
        success: true,
        occurrencesFormatted: ranges.length,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to format: ${(err as Error).message}`,
      }),
    };
  }
}

async function executeCreateBulletedList(
  args: { items: string[]; anchor?: string },
  event: WorkspaceEvent,
): Promise<ToolResult> {

  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (!oauthToken || !event.docs?.id) {
    throw new DocsFileScopeError();
  }
  if (!args.items || args.items.length === 0) {
    return {
      result: JSON.stringify({ error: "items must contain at least one entry" }),
    };
  }

  try {
    const doc = await fetchDoc(event.docs.id, oauthToken);

    // Determine insertion index. If anchor provided, insert after it;
    // otherwise insert at end of body (endIndex - 1 to stay before final newline).
    let insertIndex: number;
    if (args.anchor) {
      const range = findTextRange(doc.body, args.anchor);
      if (!range) {
        return {
          result: JSON.stringify({
            error: `Anchor text not found: "${args.anchor.slice(0, 80)}"`,
          }),
        };
      }
      insertIndex = range.endIndex;
    } else {
      // Use the document end (last element's endIndex - 1, since the very
      // last position is the trailing newline marker)
      const content = doc.body?.content ?? [];
      const last = content[content.length - 1];
      insertIndex = (last?.endIndex ?? 1) - 1;
    }

    // Build text: each item on its own line, with leading newline so it
    // doesn't merge into the prior paragraph.
    const listText = "\n" + args.items.join("\n") + "\n";
    const listStartIndex = insertIndex + 1; // skip the leading newline
    const listEndIndex = insertIndex + listText.length;

    const requests: any[] = [
      {
        insertText: {
          location: { index: insertIndex },
          text: listText,
        },
      },
      {
        createParagraphBullets: {
          range: { startIndex: listStartIndex, endIndex: listEndIndex },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
        },
      },
    ];

    const response = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(event.docs.id)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      return {
        result: JSON.stringify({
          error: `Docs API error: ${response.status}`,
        }),
      };
    }

    return {
      result: JSON.stringify({
        success: true,
        items: args.items.length,
      }),
    };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: `Failed to create list: ${(err as Error).message}`,
      }),
    };
  }
}
