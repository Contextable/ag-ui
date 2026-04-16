import { describe, it, expect } from "vitest";
import { docsModule, isDocsWriteTool } from "../../src/apps/docs/index";
import { extractDocsContext } from "../../src/apps/docs/context";
import { getDocsTools, executeDocsTool } from "../../src/apps/docs/tools";
import type { WorkspaceEvent } from "../../src/types";

const baseEvent: WorkspaceEvent = {
  commonEventObject: {
    userLocale: "en",
    hostApp: "DOCS",
    platform: "WEB",
  },
};

const docsEvent: WorkspaceEvent = {
  ...baseEvent,
  docs: {
    id: "doc-123",
    title: "My Document",
    addonHasFileScopePermission: true,
  },
  authorizationEventObject: {
    userOAuthToken: "oauth-token",
    userIdToken: "id-token",
    systemIdToken: "system-token",
  },
};

describe("Docs Module", () => {
  describe("HostAppModule interface", () => {
    it("has correct hostApp", () => {
      expect(docsModule.hostApp).toBe("DOCS");
    });

    it("getTools returns read-only tools for basic events", () => {
      const tools = docsModule.getTools(baseEvent);
      const names = tools.map((t) => t.name);
      expect(names).toContain("read_document");
      expect(names).toContain("get_document_outline");
      // Write tools should NOT be present without file scope
      expect(names).not.toContain("insert_text");
    });

    it("getTools includes write tools when file scope is granted", () => {
      const tools = docsModule.getTools(docsEvent);
      const names = tools.map((t) => t.name);
      expect(names).toContain("read_document");
      expect(names).toContain("get_document_outline");
      expect(names).toContain("insert_text");
      expect(names).toContain("replace_text");
      expect(names).toContain("insert_after_text");
      expect(names).toContain("apply_text_format");
      expect(names).toContain("create_bulleted_list");
    });

    it("executeTool returns null for unknown tools", async () => {
      const result = await docsModule.executeTool(
        {
          id: "tc-1",
          type: "function",
          function: { name: "unknown", arguments: "{}" },
        },
        baseEvent,
      );
      expect(result).toBeNull();
    });
  });

  describe("Context Extraction", () => {
    it("returns host app context for events without docs data", async () => {
      const contexts = await extractDocsContext(baseEvent);
      expect(contexts).toHaveLength(1);
      expect(contexts[0].value).toBe("DOCS");
    });

    it("includes doc ID, title, and permission status", async () => {
      const contexts = await extractDocsContext(docsEvent);
      expect(contexts.find((c) => c.value === "doc-123")).toBeTruthy();
      expect(contexts.find((c) => c.value === "My Document")).toBeTruthy();
      expect(
        contexts.find(
          (c) =>
            c.description.includes("file scope") && c.value === "true",
        ),
      ).toBeTruthy();
    });
  });

  describe("Tool Classification", () => {
    it("insert_text is a write tool", () => {
      expect(isDocsWriteTool("insert_text")).toBe(true);
    });
    it("replace_text is a write tool", () => {
      expect(isDocsWriteTool("replace_text")).toBe(true);
    });
    it("insert_after_text is a write tool", () => {
      expect(isDocsWriteTool("insert_after_text")).toBe(true);
    });
    it("apply_text_format is a write tool", () => {
      expect(isDocsWriteTool("apply_text_format")).toBe(true);
    });
    it("create_bulleted_list is a write tool", () => {
      expect(isDocsWriteTool("create_bulleted_list")).toBe(true);
    });
    it("read_document is not a write tool", () => {
      expect(isDocsWriteTool("read_document")).toBe(false);
    });
    it("get_document_outline is not a write tool", () => {
      expect(isDocsWriteTool("get_document_outline")).toBe(false);
    });
  });

  describe("Tool Execution", () => {
    it("read_document returns file-scope request when permission missing", async () => {
      const result = await executeDocsTool(
        {
          id: "tc-1",
          type: "function",
          function: { name: "read_document", arguments: "{}" },
        },
        baseEvent, // no addonHasFileScopePermission
      );
      expect(result!.isActionResponse).toBe(true);
      expect(
        (result!.actionResponse as any).hostAppAction.editorAction
          .requestFileScopeForActiveDocument,
      ).toBeDefined();
    });

    it("insert_text returns file-scope request when permission missing", async () => {
      const result = await executeDocsTool(
        {
          id: "tc-1",
          type: "function",
          function: {
            name: "insert_text",
            arguments: JSON.stringify({ text: "Hello" }),
          },
        },
        baseEvent,
      );
      expect(result!.isActionResponse).toBe(true);
      expect(
        (result!.actionResponse as any).hostAppAction.editorAction
          .requestFileScopeForActiveDocument,
      ).toBeDefined();
    });

    it("replace_text returns file-scope request when permission missing", async () => {
      const result = await executeDocsTool(
        {
          id: "tc-1",
          type: "function",
          function: {
            name: "replace_text",
            arguments: JSON.stringify({ find: "old", replace: "new" }),
          },
        },
        baseEvent,
      );
      expect(result!.isActionResponse).toBe(true);
      expect(
        (result!.actionResponse as any).hostAppAction.editorAction
          .requestFileScopeForActiveDocument,
      ).toBeDefined();
    });
  });
});
