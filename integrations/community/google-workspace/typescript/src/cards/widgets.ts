/**
 * Helper functions for building Google Workspace CardService JSON.
 *
 * Google Workspace Add-ons use a card-based UI model. These helpers produce
 * the JSON structures that Google's rendering engine expects.
 *
 * Reference: https://developers.google.com/workspace/add-ons/reference/rpc/google.apps.card.v1
 */

export interface Card {
  header?: CardHeader;
  sections: CardSection[];
  fixedFooter?: CardFixedFooter;
}

export interface CardHeader {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  imageType?: "CIRCLE" | "SQUARE";
}

export interface CardSection {
  header?: string;
  collapsible?: boolean;
  uncollapsibleWidgetsCount?: number;
  widgets: Widget[];
}

export interface Widget {
  textParagraph?: { text: string };
  decoratedText?: {
    topLabel?: string;
    text: string;
    bottomLabel?: string;
    startIcon?: Icon;
    wrapText?: boolean;
    onClick?: OnClick;
  };
  textInput?: {
    name: string;
    label?: string;
    hintText?: string;
    value?: string;
    type?: "SINGLE_LINE" | "MULTIPLE_LINE";
  };
  buttonList?: { buttons: Button[] };
  image?: { imageUrl: string; altText?: string; onClick?: OnClick };
  divider?: Record<string, never>;
}

export interface Button {
  text: string;
  onClick: OnClick;
  color?: { red: number; green: number; blue: number; alpha: number };
  disabled?: boolean;
}

export interface OnClick {
  action?: {
    function: string;
    parameters?: Array<{ key: string; value: string }>;
  };
  openLink?: { url: string };
}

export interface Icon {
  knownIcon?: string;
  iconUrl?: string;
}

export interface CardFixedFooter {
  primaryButton?: Button;
  secondaryButton?: Button;
}

// ── Builder helpers ──

export function textParagraph(text: string): Widget {
  return { textParagraph: { text } };
}

export function decoratedText(opts: {
  topLabel?: string;
  text: string;
  bottomLabel?: string;
  icon?: string;
  wrapText?: boolean;
}): Widget {
  return {
    decoratedText: {
      topLabel: opts.topLabel,
      text: opts.text,
      bottomLabel: opts.bottomLabel,
      startIcon: opts.icon ? { knownIcon: opts.icon } : undefined,
      wrapText: opts.wrapText ?? true,
    },
  };
}

export function textInput(opts: {
  name: string;
  label?: string;
  hintText?: string;
  value?: string;
  multiLine?: boolean;
}): Widget {
  return {
    textInput: {
      name: opts.name,
      label: opts.label,
      hintText: opts.hintText,
      value: opts.value,
      type: opts.multiLine ? "MULTIPLE_LINE" : "SINGLE_LINE",
    },
  };
}

export function buttonList(...buttons: Button[]): Widget {
  return { buttonList: { buttons } };
}

export function actionButton(
  text: string,
  functionName: string,
  parameters?: Record<string, string>,
): Button {
  return {
    text,
    onClick: {
      action: {
        function: functionName,
        parameters: parameters
          ? Object.entries(parameters).map(([key, value]) => ({ key, value }))
          : undefined,
      },
    },
  };
}

export function linkButton(text: string, url: string): Button {
  return {
    text,
    onClick: { openLink: { url } },
  };
}

export function divider(): Widget {
  return { divider: {} };
}

export function section(
  header: string | undefined,
  widgets: Widget[],
): CardSection {
  return { header, widgets };
}

export function card(opts: {
  title: string;
  subtitle?: string;
  sections: CardSection[];
}): Card {
  return {
    header: { title: opts.title, subtitle: opts.subtitle },
    sections: opts.sections,
  };
}

/**
 * Wraps a card in the renderActions envelope that Google expects.
 */
export function renderCard(c: Card): { renderActions: { action: { navigations: Array<{ pushCard: Card }> } } } {
  return {
    renderActions: {
      action: {
        navigations: [{ pushCard: c }],
      },
    },
  };
}

/**
 * Wraps cards for the response format Google expects from homepage/contextual triggers.
 */
export function cardResponse(...cards: Card[]): { action: { navigations: Array<{ pushCard: Card }> } } {
  return {
    action: {
      navigations: cards.map((c) => ({ pushCard: c })),
    },
  };
}
