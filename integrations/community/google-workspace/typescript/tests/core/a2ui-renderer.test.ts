import { describe, expect, it } from "vitest";
import {
  buildSurfaceStates,
  readJsonPointer,
  renderA2UISurfaces,
  resolveBinding,
  resolveString,
  type A2UIOperation,
} from "../../src/core/a2ui-renderer";

const BASE = "https://add-on.example.com";

function renderOne(ops: A2UIOperation[]) {
  const surfaces = renderA2UISurfaces(ops, { actionBaseUrl: BASE });
  expect(surfaces).toHaveLength(1);
  return surfaces[0];
}

// ── JSON Pointer + data binding helpers ──

describe("JSON Pointer", () => {
  it("reads root and nested paths", () => {
    const data = { form: { name: "Alice" }, items: [{ title: "t1" }] };
    expect(readJsonPointer(data, "/")).toBe(data);
    expect(readJsonPointer(data, "/form/name")).toBe("Alice");
    expect(readJsonPointer(data, "/items/0/title")).toBe("t1");
  });

  it("returns undefined for missing paths", () => {
    expect(readJsonPointer({}, "/missing")).toBeUndefined();
    expect(readJsonPointer({ a: null }, "/a/b")).toBeUndefined();
  });
});

describe("resolveBinding", () => {
  const data = { user: { name: "Alice" }, count: 3 };

  it("passes literals through unchanged", () => {
    expect(resolveBinding("hello", data)).toBe("hello");
    expect(resolveBinding(42, data)).toBe(42);
    expect(resolveBinding(true, data)).toBe(true);
    expect(resolveBinding(null, data)).toBe(null);
  });

  it("resolves { path } references", () => {
    expect(resolveBinding({ path: "/user/name" }, data)).toBe("Alice");
    expect(resolveBinding({ path: "/count" }, data)).toBe(3);
  });

  it("resolves {{ path }} templates in strings", () => {
    expect(resolveString("Hello {{ /user/name }}", data)).toBe("Hello Alice");
    expect(resolveString("Count: {{ count }}", data)).toBe("Count: 3");
  });

  it("renders empty string for missing template paths", () => {
    expect(resolveString("Hello {{ /missing }}", data)).toBe("Hello ");
  });
});

// ── Surface-state accumulation ──

describe("buildSurfaceStates", () => {
  it("merges updateComponents by id (later wins)", () => {
    const states = buildSurfaceStates([
      {
        version: "v0.9",
        createSurface: { surfaceId: "s1" },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "root", component: "Text", text: "first" },
          ],
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "root", component: "Text", text: "second" },
          ],
        },
      },
    ]);
    const s1 = states.get("s1");
    expect(s1?.components.get("root")?.text).toBe("second");
  });

  it("writes updateDataModel at JSON Pointer", () => {
    const states = buildSurfaceStates([
      { version: "v0.9", createSurface: { surfaceId: "s1" } },
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "s1",
          value: { form: { name: "A" } },
        },
      },
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "s1",
          path: "/form/name",
          value: "B",
        },
      },
    ]);
    expect(states.get("s1")?.data).toEqual({ form: { name: "B" } });
  });

  it("deleteSurface drops the surface", () => {
    const states = buildSurfaceStates([
      { version: "v0.9", createSurface: { surfaceId: "s1" } },
      { version: "v0.9", deleteSurface: { surfaceId: "s1" } },
    ]);
    expect(states.has("s1")).toBe(false);
  });
});

// ── Component rendering ──

describe("component rendering", () => {
  it("Text → textParagraph with literal content", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "root", component: "Text", text: "Hello" }],
        },
      },
    ]);
    const widget = rendered.card.sections[0].widgets[0];
    expect(widget.textParagraph?.text).toBe("Hello");
  });

  it("Text with path binding resolves from data model", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "Text", text: { path: "/name" } },
          ],
        },
      },
      {
        version: "v0.9",
        updateDataModel: { surfaceId: "s", value: { name: "Alice" } },
      },
    ]);
    const widget = rendered.card.sections[0].widgets[0];
    expect(widget.textParagraph?.text).toBe("Alice");
  });

  it("Text variant h1/h2/... renders as bold decoratedText", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "Text", text: "Title", variant: "h1" },
          ],
        },
      },
    ]);
    const widget = rendered.card.sections[0].widgets[0];
    expect(widget.decoratedText?.text).toContain("<b>Title</b>");
  });

  it("Column renders all children in order", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "Column", children: ["a", "b"] },
            { id: "a", component: "Text", text: "one" },
            { id: "b", component: "Text", text: "two" },
          ],
        },
      },
    ]);
    const widgets = rendered.card.sections[0].widgets;
    expect(widgets).toHaveLength(2);
    expect(widgets[0].textParagraph?.text).toBe("one");
    expect(widgets[1].textParagraph?.text).toBe("two");
  });

  it("Row falls back to vertical stacking (same as Column)", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "Row", children: ["a", "b"] },
            { id: "a", component: "Text", text: "one" },
            { id: "b", component: "Text", text: "two" },
          ],
        },
      },
    ]);
    expect(rendered.card.sections[0].widgets).toHaveLength(2);
  });

  it("Button renders as buttonList with action URL params", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s1" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [
            {
              id: "root",
              component: "Button",
              child: "label",
              action: { event: { name: "confirm" } },
            },
            { id: "label", component: "Text", text: "Confirm" },
          ],
        },
      },
    ]);
    const widget = rendered.card.sections[0].widgets[0];
    const btn = widget.buttonList?.buttons[0];
    expect(btn?.text).toBe("Confirm");
    const fn = btn?.onClick.action?.function ?? "";
    expect(fn).toContain("/actions/a2ui-interact");
    expect(fn).toContain("surfaceId=s1");
    expect(fn).toContain("componentId=root");
    expect(fn).toContain("actionName=confirm");
    // Parameters mirror the URL for reliable retrieval on our side.
    const params = Object.fromEntries(
      (btn?.onClick.action?.parameters ?? []).map((p) => [p.key, p.value]),
    );
    expect(params).toEqual({
      surfaceId: "s1",
      componentId: "root",
      actionName: "confirm",
    });
  });

  it("Image renders with url + altText", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            {
              id: "root",
              component: "Image",
              url: "https://example.com/a.png",
              description: "alt",
            },
          ],
        },
      },
    ]);
    const widget = rendered.card.sections[0].widgets[0];
    expect(widget.image?.imageUrl).toBe("https://example.com/a.png");
    expect(widget.image?.altText).toBe("alt");
  });

  it("TextField uses component id as name and respects longText variant", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            {
              id: "root",
              component: "TextField",
              label: "Body",
              variant: "longText",
            },
          ],
        },
      },
    ]);
    const widget = rendered.card.sections[0].widgets[0];
    expect(widget.textInput?.name).toBe("root");
    expect(widget.textInput?.label).toBe("Body");
    expect(widget.textInput?.type).toBe("MULTIPLE_LINE");
  });

  it("Checkbox renders as selectionInput CHECK_BOX", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            {
              id: "root",
              component: "CheckBox",
              label: "Agree",
              value: true,
            },
          ],
        },
      },
    ]);
    const widget = rendered.card.sections[0].widgets[0];
    expect(widget.selectionInput?.type).toBe("CHECK_BOX");
    expect(widget.selectionInput?.items[0].text).toBe("Agree");
    expect(widget.selectionInput?.items[0].selected).toBe(true);
  });

  it("ChoicePicker (mutually exclusive) renders DROPDOWN; options resolve via path", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            {
              id: "root",
              component: "ChoicePicker",
              label: "Assignee",
              options: [
                { label: "Alice", value: "alice@example.com" },
                { label: "Bob", value: "bob@example.com" },
              ],
              value: { path: "/selected" },
            },
          ],
        },
      },
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "s",
          value: { selected: "bob@example.com" },
        },
      },
    ]);
    const widget = rendered.card.sections[0].widgets[0];
    expect(widget.selectionInput?.type).toBe("DROPDOWN");
    expect(widget.selectionInput?.label).toBe("Assignee");
    expect(widget.selectionInput?.items).toHaveLength(2);
    expect(
      widget.selectionInput?.items.find((i) => i.value === "bob@example.com")?.selected,
    ).toBe(true);
  });

  it("ChoicePicker (multipleSelection) renders CHECK_BOX with multiple selected", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            {
              id: "root",
              component: "ChoicePicker",
              variant: "multipleSelection",
              options: [
                { label: "a", value: "1" },
                { label: "b", value: "2" },
                { label: "c", value: "3" },
              ],
              value: ["1", "3"],
            },
          ],
        },
      },
    ]);
    const widget = rendered.card.sections[0].widgets[0];
    expect(widget.selectionInput?.type).toBe("CHECK_BOX");
    const selected = (widget.selectionInput?.items ?? [])
      .filter((i) => i.selected)
      .map((i) => i.value);
    expect(selected.sort()).toEqual(["1", "3"]);
  });

  it("DateTimeInput with both enabled renders DATE_AND_TIME", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "DateTimeInput", label: "When" },
          ],
        },
      },
    ]);
    const widget = rendered.card.sections[0].widgets[0];
    expect(widget.dateTimePicker?.type).toBe("DATE_AND_TIME");
    expect(widget.dateTimePicker?.label).toBe("When");
  });

  it("Divider renders natively", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "root", component: "Divider" }],
        },
      },
    ]);
    expect(rendered.card.sections[0].widgets[0].divider).toEqual({});
  });

  it("Card wraps its child", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "Card", child: "inner" },
            { id: "inner", component: "Text", text: "Inside" },
          ],
        },
      },
    ]);
    expect(rendered.card.sections[0].widgets[0].textParagraph?.text).toBe("Inside");
  });

  it("unknown component renders a placeholder", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "root", component: "Slider" }],
        },
      },
    ]);
    expect(rendered.card.sections[0].widgets[0].textParagraph?.text).toBe(
      "[unsupported: Slider]",
    );
  });

  it("missing root renders a placeholder card", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "not-root", component: "Text", text: "x" }],
        },
      },
    ]);
    expect(rendered.card.sections[0].widgets[0].textParagraph?.text).toBe(
      "[A2UI surface has no root component]",
    );
  });

  it("end-to-end form: Card wrapping Column(TextField, Button) with a data model", () => {
    const rendered = renderOne([
      { version: "v0.9", createSurface: { surfaceId: "form1" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "form1",
          components: [
            { id: "root", component: "Card", child: "col" },
            {
              id: "col",
              component: "Column",
              children: ["name", "send"],
            },
            {
              id: "name",
              component: "TextField",
              label: "Name",
              text: { path: "/form/name" },
            },
            {
              id: "send",
              component: "Button",
              child: "send-label",
              action: { event: { name: "submit" } },
            },
            { id: "send-label", component: "Text", text: "Submit" },
          ],
        },
      },
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "form1",
          value: { form: { name: "Alice" } },
        },
      },
    ]);
    const widgets = rendered.card.sections[0].widgets;
    expect(widgets[0].textInput?.name).toBe("name");
    expect(widgets[0].textInput?.value).toBe("Alice");
    expect(widgets[1].buttonList?.buttons[0].text).toBe("Submit");
    expect(widgets[1].buttonList?.buttons[0].onClick.action?.function).toContain(
      "surfaceId=form1",
    );
  });
});

describe("multiple surfaces", () => {
  it("renders one card per surfaceId", () => {
    const surfaces = renderA2UISurfaces(
      [
        { version: "v0.9", createSurface: { surfaceId: "a" } },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "a",
            components: [{ id: "root", component: "Text", text: "A" }],
          },
        },
        { version: "v0.9", createSurface: { surfaceId: "b" } },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "b",
            components: [{ id: "root", component: "Text", text: "B" }],
          },
        },
      ],
      { actionBaseUrl: BASE },
    );
    expect(surfaces.map((s) => s.surfaceId).sort()).toEqual(["a", "b"]);
  });
});
