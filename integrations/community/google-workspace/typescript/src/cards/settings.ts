import type { UserConfig } from "../types";
import {
  type Card,
  section,
  card,
  textParagraph,
  textInput,
  buttonList,
  actionButton,
  decoratedText,
} from "./widgets";

export interface SettingsCardOpts {
  currentConfig?: UserConfig | null;
  message?: string;
  error?: string;
  /** Base URL for action endpoints (HTTP add-on requirement) */
  baseUrl?: string;
}

/**
 * Renders the settings card where users configure their AG-UI backend URL
 * and optional authentication credentials.
 */
export function settingsCard(opts: SettingsCardOpts = {}): Card {
  const baseUrl = (opts.baseUrl ?? process.env.ACTION_BASE_URL ?? "").replace(
    /\/$/,
    "",
  );
  const widgets = [];

  if (opts.message) {
    widgets.push(
      decoratedText({
        text: opts.message,
        icon: "CONFIRMATION_NUMBER_ICON",
      }),
    );
  }

  if (opts.error) {
    widgets.push(
      decoratedText({
        text: opts.error,
        icon: "DESCRIPTION",
        topLabel: "Error",
      }),
    );
  }

  widgets.push(
    textInput({
      name: "backend_url",
      label: "Backend URL",
      hintText: "https://your-agent.example.com/ag-ui",
      value: opts.currentConfig?.backendUrl ?? "",
    }),
    textInput({
      name: "auth_token",
      label: "Auth Token (optional)",
      hintText: "Bearer token or API key",
      value: opts.currentConfig?.authToken ?? "",
    }),
    buttonList(
      actionButton("Save", `${baseUrl}/actions/save-settings`),
      actionButton("Test Connection", `${baseUrl}/actions/test-connection`),
      actionButton("Back", `${baseUrl}/homepage`),
    ),
  );

  return card({
    title: "Settings",
    subtitle: "Configure your AG-UI backend",
    sections: [section(undefined, widgets)],
  });
}
