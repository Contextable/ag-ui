import type { Context } from "@ag-ui/core";
import type { WorkspaceEvent } from "../../types";

/**
 * Extracts Docs context from the workspace event.
 *
 * Google provides the document ID, title, and whether the add-on has
 * file scope permission. Full document content must be fetched via the
 * Docs API (requires drive.file scope granted via onFileScopeGrantedTrigger).
 */
export async function extractDocsContext(
  event: WorkspaceEvent,
): Promise<Context[]> {
  const contexts: Context[] = [
    { description: "Google Workspace host application", value: "DOCS" },
  ];

  if (!event.docs) {
    return contexts;
  }

  if (event.docs.id) {
    contexts.push({
      description: "Google Docs document ID",
      value: event.docs.id,
    });
  }

  if (event.docs.title) {
    contexts.push({
      description: "Document title",
      value: event.docs.title,
    });
  }

  contexts.push({
    description: "Add-on has file scope permission",
    value: String(event.docs.addonHasFileScopePermission ?? false),
  });

  // Fetch document content if we have permission and an OAuth token
  const oauthToken = event.authorizationEventObject?.userOAuthToken;
  if (oauthToken && event.docs.id && event.docs.addonHasFileScopePermission) {
    try {
      const content = await fetchDocContent(event.docs.id, oauthToken);
      if (content) {
        contexts.push({
          description: "Document content (plain text)",
          value: content.slice(0, 3000),
        });
      }
    } catch (err) {
      console.error("Failed to fetch document content:", err);
    }
  }

  return contexts;
}

async function fetchDocContent(
  documentId: string,
  oauthToken: string,
): Promise<string | null> {
  const response = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`,
    {
      headers: { Authorization: `Bearer ${oauthToken}` },
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!response.ok) return null;

  const doc: any = await response.json();

  // Extract plain text from the document body
  const text = extractTextFromBody(doc.body);
  return text || null;
}

/**
 * Extracts plain text from a Google Docs document body.
 * The body contains structural elements with paragraph elements
 * containing text runs.
 */
function extractTextFromBody(body: any): string {
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
    if (element.table) {
      // Simplified table extraction
      for (const row of element.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          const cellText = extractTextFromBody(cell);
          if (cellText) parts.push(cellText);
        }
      }
    }
  }

  return parts.join("");
}
