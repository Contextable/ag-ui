/**
 * Render A2UI v0.9 operations as Google Workspace card JSON.
 *
 * The A2UI Python SDK emits v0.9 `a2ui_operations` (createSurface,
 * updateComponents, updateDataModel) via the `send_a2ui_json_to_client`
 * tool. `@ag-ui/a2ui-middleware` surfaces them as `ACTIVITY_SNAPSHOT`
 * events with `activityType: "a2ui-surface"`. The renderer here converts
 * those operations — once accumulated into a surface state — into the
 * CardService widgets that Google Workspace sidebars expect.
 *
 * Each render is per-turn: we don't persist surface state between runs.
 * The agent re-emits operations each time it wants to show UI.
 *
 * Scope note (per plan): components that render natively in CardService
 * get first-class mappings; the rest have pragmatic fallbacks.
 */

import {
  actionButton,
  buttonList,
  card,
  dateTimePicker,
  decoratedText,
  divider,
  image,
  section,
  selectionInput,
  textInput,
  textParagraph,
  type Button,
  type Card,
  type CardSection,
  type Widget,
} from "../cards/widgets";

// ── Types mirroring the A2UI v0.9 wire format ──

export interface A2UIOperation {
  version?: string;
  createSurface?: {
    surfaceId: string;
    catalogId?: string;
    title?: string;
  };
  updateComponents?: {
    surfaceId: string;
    components: A2UIComponent[];
  };
  updateDataModel?: {
    surfaceId: string;
    path?: string; // JSON Pointer; defaults to "/"
    value: unknown;
  };
  deleteSurface?: { surfaceId: string };
}

export interface A2UIComponent {
  id: string;
  component: string;
  [key: string]: unknown;
}

export interface RenderedSurface {
  surfaceId: string;
  title?: string;
  card: Card;
}

export interface RenderOptions {
  /** Base URL for action button `function:` targets (typically ACTION_BASE_URL). */
  actionBaseUrl: string;
  /** Action path, e.g. "/actions/a2ui-interact". Defaults to that. */
  actionPath?: string;
}

// ── Surface-state accumulation from operations ──

interface SurfaceState {
  surfaceId: string;
  title?: string;
  components: Map<string, A2UIComponent>;
  data: Record<string, unknown>;
}

/**
 * Group operations by surfaceId and apply them in order.
 * Multiple `updateComponents` merge (later defs replace earlier by id).
 * `updateDataModel` writes into `state.data` at the given JSON Pointer.
 */
function buildSurfaceStates(operations: A2UIOperation[]): Map<string, SurfaceState> {
  const states = new Map<string, SurfaceState>();
  const getState = (surfaceId: string): SurfaceState => {
    let s = states.get(surfaceId);
    if (!s) {
      s = { surfaceId, components: new Map(), data: {} };
      states.set(surfaceId, s);
    }
    return s;
  };

  for (const op of operations) {
    if (op.createSurface) {
      const s = getState(op.createSurface.surfaceId);
      if (op.createSurface.title) s.title = op.createSurface.title;
    } else if (op.updateComponents) {
      const s = getState(op.updateComponents.surfaceId);
      for (const c of op.updateComponents.components) {
        s.components.set(c.id, c);
      }
    } else if (op.updateDataModel) {
      const s = getState(op.updateDataModel.surfaceId);
      writeJsonPointer(s.data, op.updateDataModel.path ?? "/", op.updateDataModel.value);
    } else if (op.deleteSurface) {
      states.delete(op.deleteSurface.surfaceId);
    }
  }
  return states;
}

// ── Data binding: JSON Pointer + {path}/{{path}} resolution ──

/** Parse a JSON Pointer like "/form/name" into ["form", "name"]. "/" → []. */
function parsePointer(pointer: string): string[] {
  if (!pointer || pointer === "/") return [];
  if (pointer.startsWith("/")) pointer = pointer.slice(1);
  return pointer
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function readJsonPointer(root: unknown, pointer: string): unknown {
  const parts = parsePointer(pointer);
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(p);
      cur = Number.isFinite(i) ? cur[i] : undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function writeJsonPointer(
  root: Record<string, unknown>,
  pointer: string,
  value: unknown,
): void {
  const parts = parsePointer(pointer);
  if (parts.length === 0) {
    // Replace root object contents.
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const k of Object.keys(root)) delete root[k];
      Object.assign(root, value);
    }
    return;
  }
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Resolve a value that may be:
 *  - a literal (string, number, boolean, null, undefined)
 *  - a path reference: `{ "path": "/form/name" }`
 *  - a template string: `"Hello {{ /user/name }}"`
 *
 * Returns the resolved value (any type). Missing paths → undefined (or "" for templates).
 */
function resolveBinding(value: unknown, data: Record<string, unknown>): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.path === "string") {
      return readJsonPointer(data, obj.path);
    }
  }
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr: string) => {
      const v = readJsonPointer(data, expr.startsWith("/") ? expr : `/${expr}`);
      return v == null ? "" : String(v);
    });
  }
  return value;
}

function resolveString(value: unknown, data: Record<string, unknown>): string {
  const v = resolveBinding(value, data);
  return v == null ? "" : String(v);
}

function resolveBoolean(value: unknown, data: Record<string, unknown>): boolean {
  const v = resolveBinding(value, data);
  return Boolean(v);
}

// ── Component renderers ──

interface Ctx {
  state: SurfaceState;
  opts: RenderOptions;
}

function getComponent(state: SurfaceState, id: string): A2UIComponent | undefined {
  return state.components.get(id);
}

function renderTree(ctx: Ctx, id: string): Widget[] {
  const c = getComponent(ctx.state, id);
  if (!c) {
    console.warn(`[a2ui-renderer] missing component id=${id} on surface ${ctx.state.surfaceId}`);
    return [textParagraph(`[missing component: ${id}]`)];
  }
  try {
    return renderComponent(ctx, c);
  } catch (err) {
    // Surface the failure to the logs in addition to the inline card text,
    // so operators can correlate user-visible "[render error]" widgets
    // with what actually threw. Include the component type + id for
    // quick triage.
    console.error(
      `[a2ui-renderer] render failed for component id=${id} type=${c.component} on surface ${ctx.state.surfaceId}:`,
      (err as Error).stack ?? (err as Error).message,
    );
    return [textParagraph(`[render error: ${(err as Error).message}]`)];
  }
}

function renderChildren(
  ctx: Ctx,
  children: unknown,
): Widget[] {
  // `children` is an array of component IDs, or a template referencing one.
  const resolved = resolveBinding(children, ctx.state.data);
  const ids = Array.isArray(resolved) ? (resolved as unknown[]) : [];
  const out: Widget[] = [];
  for (const child of ids) {
    if (typeof child === "string") {
      out.push(...renderTree(ctx, child));
    }
  }
  return out;
}

function renderSingleChild(ctx: Ctx, child: unknown): Widget[] {
  // `child` is a single component ID (Button, Card, Modal).
  const resolved = resolveBinding(child, ctx.state.data);
  return typeof resolved === "string" ? renderTree(ctx, resolved) : [];
}

function renderComponent(ctx: Ctx, c: A2UIComponent): Widget[] {
  switch (c.component) {
    case "Text":
      return renderText(ctx, c);
    case "Button":
      return renderButton(ctx, c);
    case "Image":
      return renderImage(ctx, c);
    case "Divider":
      return [divider()];
    case "TextField":
      return renderTextField(ctx, c);
    case "CheckBox":
    case "Checkbox": // lenient
      return renderCheckbox(ctx, c);
    case "ChoicePicker":
      return renderChoicePicker(ctx, c);
    case "DateTimeInput":
      return renderDateTime(ctx, c);
    case "Icon":
      return renderIcon(ctx, c);
    case "Column":
    case "Row": // sidebars are narrow — Row falls back to vertical stacking
    case "List":
      return renderChildren(ctx, (c as Record<string, unknown>).children);
    case "Card":
      return renderSingleChild(ctx, (c as Record<string, unknown>).child);
    case "Modal":
      // No inline modal in CardService; render the child inline with a divider.
      return [divider(), ...renderSingleChild(ctx, (c as Record<string, unknown>).child)];
    case "Tabs":
      return renderChildren(ctx, (c as Record<string, unknown>).children);
    default:
      // Unknown / unsupported (Video, AudioPlayer, Slider, etc.): show a
      // plain-text placeholder so the card still renders.
      return [textParagraph(`[unsupported: ${c.component}]`)];
  }
}

// ── Individual renderers ──

function renderText(ctx: Ctx, c: A2UIComponent): Widget[] {
  const text = resolveString(c.text, ctx.state.data);
  const variant = typeof c.variant === "string" ? c.variant : "body";
  if (variant.startsWith("h")) {
    // Heading — use decoratedText for visual weight.
    return [decoratedText({ text: `<b>${escapeHtml(text)}</b>` })];
  }
  if (variant === "caption") {
    return [decoratedText({ text: `<font color="#888888">${escapeHtml(text)}</font>` })];
  }
  return [textParagraph(escapeHtml(text))];
}

function renderButton(ctx: Ctx, c: A2UIComponent): Widget[] {
  // Resolve the button's text from its child (usually a Text component).
  const childId = typeof c.child === "string" ? c.child : undefined;
  let label = "";
  if (childId) {
    const child = getComponent(ctx.state, childId);
    if (child && child.component === "Text") {
      label = resolveString(child.text, ctx.state.data);
    } else if (child) {
      label = `(${child.component})`;
    }
  }
  if (!label) label = "Submit";

  const actionName = extractActionName(c.action);
  // Pass surface/component/action to the interaction route; form inputs
  // (named after their component ids) are appended by CardService itself.
  const btn: Button = actionButton(
    label,
    buildActionUrl(ctx.opts, {
      surfaceId: ctx.state.surfaceId,
      componentId: c.id,
      actionName,
    }),
    {
      surfaceId: ctx.state.surfaceId,
      componentId: c.id,
      actionName,
    },
  );
  return [buttonList(btn)];
}

function renderImage(ctx: Ctx, c: A2UIComponent): Widget[] {
  const url = resolveString(c.url, ctx.state.data);
  if (!url) return [];
  const alt = resolveString(c.description, ctx.state.data) || undefined;
  return [image({ url, altText: alt })];
}

function renderTextField(ctx: Ctx, c: A2UIComponent): Widget[] {
  const label = resolveString(c.label, ctx.state.data);
  const initial = resolveString(c.text ?? c.value, ctx.state.data);
  const variant = typeof c.variant === "string" ? c.variant : "shortText";
  return [
    textInput({
      name: c.id,
      label: label || undefined,
      value: initial || undefined,
      multiLine: variant === "longText",
    }),
  ];
}

function renderCheckbox(ctx: Ctx, c: A2UIComponent): Widget[] {
  const label = resolveString(c.label, ctx.state.data) || c.id;
  const selected = resolveBoolean(c.value, ctx.state.data);
  return [
    selectionInput({
      name: c.id,
      label: undefined,
      type: "CHECK_BOX",
      items: [{ text: label, value: "true", selected }],
    }),
  ];
}

function renderChoicePicker(ctx: Ctx, c: A2UIComponent): Widget[] {
  const label = resolveString(c.label, ctx.state.data) || undefined;
  const multi = (c.variant ?? "mutuallyExclusive") === "multipleSelection";
  const displayStyle = typeof c.displayStyle === "string" ? c.displayStyle : undefined;
  const type: "CHECK_BOX" | "RADIO_BUTTON" | "DROPDOWN" =
    multi ? "CHECK_BOX" : displayStyle === "chips" ? "RADIO_BUTTON" : "DROPDOWN";

  const rawOptions = Array.isArray(c.options) ? (c.options as unknown[]) : [];
  const selectedValue = resolveBinding(c.value, ctx.state.data);
  const selectedSet = new Set(
    Array.isArray(selectedValue)
      ? (selectedValue as unknown[]).map(String)
      : selectedValue != null
        ? [String(selectedValue)]
        : [],
  );
  const items = rawOptions.map((opt) => {
    const o = (opt ?? {}) as Record<string, unknown>;
    const value = String(resolveBinding(o.value, ctx.state.data) ?? "");
    const text = resolveString(o.label ?? o.value, ctx.state.data) || value;
    return { text, value, selected: selectedSet.has(value) };
  });

  return [selectionInput({ name: c.id, label, type, items })];
}

function renderDateTime(ctx: Ctx, c: A2UIComponent): Widget[] {
  const label = resolveString(c.label, ctx.state.data) || undefined;
  const enableDate = c.enableDate !== false;
  const enableTime = c.enableTime !== false;
  const type: "DATE_AND_TIME" | "DATE_ONLY" | "TIME_ONLY" =
    enableDate && enableTime ? "DATE_AND_TIME" : enableDate ? "DATE_ONLY" : "TIME_ONLY";
  const initial = resolveString(c.value, ctx.state.data);
  const valueMsEpoch = initial ? String(Date.parse(initial) || "") : undefined;
  return [dateTimePicker({ name: c.id, label, type, valueMsEpoch: valueMsEpoch || undefined })];
}

function renderIcon(ctx: Ctx, c: A2UIComponent): Widget[] {
  const name = resolveString(c.name, ctx.state.data);
  if (!name) return [];
  // CardService only supports a fixed set of knownIcons. If the requested
  // icon isn't one of them, fall back to a small text stand-in.
  const known = KNOWN_ICONS.has(name.toUpperCase()) ? name.toUpperCase() : undefined;
  return [
    decoratedText({
      text: "",
      icon: known,
    }),
  ];
}

// ── Action URL + name helpers ──

function buildActionUrl(
  opts: RenderOptions,
  params: { surfaceId: string; componentId: string; actionName: string },
): string {
  const base = opts.actionBaseUrl.replace(/\/$/, "");
  const path = opts.actionPath ?? "/actions/a2ui-interact";
  const q = new URLSearchParams({
    surfaceId: params.surfaceId,
    componentId: params.componentId,
    actionName: params.actionName,
  }).toString();
  return `${base}${path}?${q}`;
}

function extractActionName(action: unknown): string {
  if (action && typeof action === "object") {
    const a = action as Record<string, unknown>;
    const ev = a.event as Record<string, unknown> | undefined;
    if (ev && typeof ev.name === "string") return ev.name;
    if (typeof a.name === "string") return a.name;
  }
  return "action";
}

// Small, opinionated slice of CardService's knownIcon set. Extend as needed.
const KNOWN_ICONS = new Set([
  "AIRPLANE",
  "BOOKMARK",
  "BUS",
  "CAR",
  "CLOCK",
  "CONFIRMATION_NUMBER_ICON",
  "DOLLAR",
  "DESCRIPTION",
  "EMAIL",
  "EVENT_PERFORMER",
  "EVENT_SEAT",
  "FLIGHT_ARRIVAL",
  "FLIGHT_DEPARTURE",
  "HOTEL",
  "HOTEL_ROOM_TYPE",
  "INVITE",
  "MAP_PIN",
  "MEMBERSHIP",
  "MULTIPLE_PEOPLE",
  "OFFER",
  "PERSON",
  "PHONE",
  "RESTAURANT_ICON",
  "SHOPPING_CART",
  "STAR",
  "STORE",
  "TICKET",
  "TRAIN",
  "VIDEO_CAMERA",
  "VIDEO_PLAY",
]);

// ── Minimal HTML escaping for CardService text (supports <b>/<i>/<br>/<a>) ──

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Public entrypoint ──

/**
 * Render one or more A2UI surfaces from the accumulated operations.
 *
 * Each surface becomes a single `Card` with a single `section` holding
 * the flattened widget list. If no root component exists, the surface
 * renders as a placeholder card noting the missing root.
 */
export function renderA2UISurfaces(
  operations: A2UIOperation[],
  opts: RenderOptions,
): RenderedSurface[] {
  const states = buildSurfaceStates(operations);
  const out: RenderedSurface[] = [];
  for (const state of states.values()) {
    const ctx: Ctx = { state, opts };
    let widgets: Widget[];
    if (state.components.has("root")) {
      widgets = renderTree(ctx, "root");
    } else {
      widgets = [textParagraph("[A2UI surface has no root component]")];
    }
    const sections: CardSection[] = [section(undefined, widgets)];
    out.push({
      surfaceId: state.surfaceId,
      title: state.title,
      card: card({ title: state.title ?? "AG-UI Agent", sections }),
    });
  }
  return out;
}

// Re-export helpers for consumers that want to drive the renderer manually
// (tests, callers that pre-accumulate a SurfaceState).
export {
  buildSurfaceStates,
  readJsonPointer,
  resolveBinding,
  resolveString,
};
