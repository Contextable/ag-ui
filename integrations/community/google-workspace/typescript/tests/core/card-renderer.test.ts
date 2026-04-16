import { describe, it, expect } from "vitest";
import { conversationCard } from "../../src/cards/conversation";
import { settingsCard } from "../../src/cards/settings";
import { approvalCard } from "../../src/cards/approval";
import {
  textParagraph,
  decoratedText,
  textInput,
  buttonList,
  actionButton,
  linkButton,
  divider,
  section,
  card,
  renderCard,
} from "../../src/cards/widgets";

describe("Card Widgets", () => {
  it("creates a text paragraph widget", () => {
    const widget = textParagraph("Hello world");
    expect(widget.textParagraph).toEqual({ text: "Hello world" });
  });

  it("creates a decorated text widget", () => {
    const widget = decoratedText({
      topLabel: "Label",
      text: "Value",
      icon: "PERSON",
    });
    expect(widget.decoratedText?.topLabel).toBe("Label");
    expect(widget.decoratedText?.text).toBe("Value");
    expect(widget.decoratedText?.startIcon?.knownIcon).toBe("PERSON");
    expect(widget.decoratedText?.wrapText).toBe(true);
  });

  it("creates a text input widget", () => {
    const widget = textInput({
      name: "test_input",
      label: "Enter text",
      hintText: "hint",
      multiLine: true,
    });
    expect(widget.textInput?.name).toBe("test_input");
    expect(widget.textInput?.type).toBe("MULTIPLE_LINE");
  });

  it("creates an action button", () => {
    const btn = actionButton("Click me", "handleClick", { key: "value" });
    expect(btn.text).toBe("Click me");
    expect(btn.onClick.action?.function).toBe("handleClick");
    expect(btn.onClick.action?.parameters).toEqual([
      { key: "key", value: "value" },
    ]);
  });

  it("creates a link button", () => {
    const btn = linkButton("Open", "https://example.com");
    expect(btn.onClick.openLink?.url).toBe("https://example.com");
  });

  it("creates a divider", () => {
    const widget = divider();
    expect(widget.divider).toEqual({});
  });

  it("creates a complete card", () => {
    const c = card({
      title: "Test",
      subtitle: "Subtitle",
      sections: [section("Section 1", [textParagraph("content")])],
    });
    expect(c.header?.title).toBe("Test");
    expect(c.sections).toHaveLength(1);
    expect(c.sections[0].header).toBe("Section 1");
  });

  it("wraps card in renderActions envelope", () => {
    const c = card({ title: "Test", sections: [] });
    const wrapped = renderCard(c);
    expect(wrapped.renderActions.action.navigations).toHaveLength(1);
    expect(wrapped.renderActions.action.navigations[0].pushCard).toBe(c);
  });
});

describe("Conversation Card", () => {
  it("renders welcome message when no response", () => {
    const c = conversationCard();
    const responseSection = c.sections[0];
    expect(responseSection.widgets).toHaveLength(1);
    expect(responseSection.widgets[0].textParagraph?.text).toContain(
      "Welcome",
    );
  });

  it("renders agent response", () => {
    const c = conversationCard({ agentResponse: "Hello from agent" });
    const responseSection = c.sections[0];
    // Should have decorated text (agent label) + text paragraph (response)
    expect(responseSection.widgets.length).toBeGreaterThanOrEqual(2);
  });

  it("renders loading state", () => {
    const c = conversationCard({ loading: true });
    const responseSection = c.sections[0];
    expect(responseSection.widgets[0].decoratedText?.text).toBe("Thinking...");
  });

  it("renders error state", () => {
    const c = conversationCard({ error: "Something went wrong" });
    const responseSection = c.sections[0];
    expect(responseSection.widgets[0].decoratedText?.topLabel).toBe("Error");
  });

  it("renders tool calls", () => {
    const c = conversationCard({
      toolCalls: [
        { name: "search_web", status: "completed" },
        { name: "read_email", status: "pending" },
      ],
    });
    const responseSection = c.sections[0];
    expect(responseSection.widgets).toHaveLength(2);
  });

  it("always has an input section with Send, New Thread, Settings buttons", () => {
    const c = conversationCard();
    const inputSection = c.sections[1];
    expect(inputSection.header).toBe("Input");
    // Text input + button list
    expect(inputSection.widgets).toHaveLength(2);
    expect(inputSection.widgets[0].textInput?.name).toBe("user_message");
    const buttons = inputSection.widgets[1].buttonList?.buttons;
    expect(buttons).toHaveLength(3);
    expect(buttons![0].text).toBe("Send");
    expect(buttons![1].text).toBe("New Thread");
    expect(buttons![2].text).toBe("Settings");
  });
});

describe("Settings Card", () => {
  it("renders with empty config", () => {
    const c = settingsCard();
    expect(c.header?.title).toBe("Settings");
    const widgets = c.sections[0].widgets;
    // Should have backend_url input + auth_token input + button list
    const inputWidgets = widgets.filter((w) => w.textInput);
    expect(inputWidgets).toHaveLength(2);
  });

  it("pre-fills existing config values", () => {
    const c = settingsCard({
      currentConfig: {
        backendUrl: "https://my-agent.com",
        authToken: "sk-123",
      },
    });
    const widgets = c.sections[0].widgets;
    const urlInput = widgets.find(
      (w) => w.textInput?.name === "backend_url",
    );
    expect(urlInput?.textInput?.value).toBe("https://my-agent.com");
  });

  it("shows success message", () => {
    const c = settingsCard({ message: "Saved!" });
    const widgets = c.sections[0].widgets;
    expect(widgets[0].decoratedText?.text).toBe("Saved!");
  });

  it("shows error message", () => {
    const c = settingsCard({ error: "Invalid URL" });
    const widgets = c.sections[0].widgets;
    expect(widgets[0].decoratedText?.topLabel).toBe("Error");
  });
});

describe("Approval Card", () => {
  it("renders tool approval with parameters", () => {
    const c = approvalCard({
      toolName: "Create Event",
      description: "Creates a new calendar event",
      parameters: {
        summary: "Team Meeting",
        start: "2026-04-20T10:00:00",
      },
      toolCallId: "tc-123",
    });

    expect(c.header?.title).toBe("Action Required");
    // 3 sections: info, parameters, buttons
    expect(c.sections).toHaveLength(3);

    // Parameters section
    const paramSection = c.sections[1];
    expect(paramSection.header).toBe("Parameters");
    expect(paramSection.widgets).toHaveLength(2);

    // Buttons section with approve/reject
    const buttonSection = c.sections[2];
    const buttons = buttonSection.widgets[0].buttonList?.buttons;
    expect(buttons).toHaveLength(2);
    expect(buttons![0].text).toBe("Approve");
    expect(buttons![1].text).toBe("Reject");

    // Verify toolCallId is passed as parameter
    const approveParams = buttons![0].onClick.action?.parameters;
    expect(approveParams).toContainEqual({
      key: "toolCallId",
      value: "tc-123",
    });
  });
});
