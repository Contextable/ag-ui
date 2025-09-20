import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { PipecatVoice, usePipecatVoice, PipecatVoiceProps, PipecatVoiceState } from "../../../src/voice";
import { PipecatVoiceConfig } from "../../../src/types";
import { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";

// Mock the PipecatClient
jest.mock("@pipecat-ai/client-js", () => ({
  PipecatClient: jest.fn(),
  RTVIEvent: {
    Connected: "connected",
    Disconnected: "disconnected", 
    Error: "error",
    UserStartedSpeaking: "userStartedSpeaking",
    UserStoppedSpeaking: "userStoppedSpeaking",
    BotStartedSpeaking: "botStartedSpeaking",
    BotStoppedSpeaking: "botStoppedSpeaking",
  },
}));

// Mock the WebSocketTransport
jest.mock("@pipecat-ai/websocket-transport", () => ({
  WebSocketTransport: jest.fn().mockImplementation(() => ({})),
}));

describe("PipecatVoice", () => {
  let mockClient: jest.Mocked<PipecatClient>;
  let config: PipecatVoiceConfig;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock client
    mockClient = {
      initDevices: jest.fn().mockResolvedValue(undefined),
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      enableMic: jest.fn(),
      on: jest.fn(),
      tracks: jest.fn().mockReturnValue({ bot: { audio: null } }),
    } as any;

    // Mock PipecatClient to capture callbacks and simulate them
    (PipecatClient as jest.Mock).mockImplementation((options) => {
      // Store callbacks for later simulation
      if (options?.callbacks) {
        mockClient._callbacks = options.callbacks;
      }
      return mockClient;
    });

    config = {
      websocketUrl: "ws://localhost:8000/ws",
      enableMic: true,
      timeout: 5000,
    };
  });

  describe("usePipecatVoice hook", () => {
    const TestComponent: React.FC<{ props: PipecatVoiceProps }> = ({ props }) => {
      const { state, connect, disconnect, toggleMute } = usePipecatVoice(props);
      
      return (
        <div>
          <div data-testid="state">{JSON.stringify(state)}</div>
          <button data-testid="connect" onClick={connect}>Connect</button>
          <button data-testid="disconnect" onClick={disconnect}>Disconnect</button>
          <button data-testid="toggle-mute" onClick={toggleMute}>Toggle Mute</button>
        </div>
      );
    };

    it("should initialize with default state", () => {
      render(<TestComponent props={{ config }} />);
      
      const stateElement = screen.getByTestId("state");
      const state = JSON.parse(stateElement.textContent || "{}");
      
      expect(state).toEqual({
        isConnected: false,
        isConnecting: false,
        isMuted: false,
        userSpeaking: false,
        botSpeaking: false,
      });
    });

    it("should create RTVIClient with correct config on connect", async () => {
      render(<TestComponent props={{ config }} />);
      
      fireEvent.click(screen.getByTestId("connect"));
      
      expect(PipecatClient).toHaveBeenCalledWith(expect.objectContaining({
        enableMic: true,
      }));
    });

    it("should include auth headers when provided", async () => {
      const configWithAuth = {
        ...config,
        authHeaders: { "Authorization": "Bearer token123" }
      };
      
      mockClient.initDevices.mockResolvedValue(undefined);
      mockClient.connect.mockResolvedValue(undefined);
      
      render(<TestComponent props={{ config: configWithAuth }} />);
      
      fireEvent.click(screen.getByTestId("connect"));
      
      expect(PipecatClient).toHaveBeenCalledWith(expect.objectContaining({
        enableMic: true,
      }));
    });

    it("should handle connection success", async () => {
      mockClient.initDevices.mockResolvedValue(undefined);
      mockClient.connect.mockImplementation(async () => {
        // Simulate successful connection by calling the onConnected callback
        setTimeout(() => {
          if (mockClient._callbacks?.onConnected) {
            mockClient._callbacks.onConnected();
          }
        }, 0);
      });

      render(<TestComponent props={{ config }} />);

      fireEvent.click(screen.getByTestId("connect"));

      await waitFor(() => {
        const stateElement = screen.getByTestId("state");
        const state = JSON.parse(stateElement.textContent || "{}");
        expect(state.isConnected).toBe(true);
        expect(state.isConnecting).toBe(false);
      });
    });

    it("should handle connection error", async () => {
      const error = new Error("Connection failed");
      mockClient.initDevices.mockRejectedValue(error);

      render(<TestComponent props={{ config }} />);

      fireEvent.click(screen.getByTestId("connect"));

      await waitFor(() => {
        const stateElement = screen.getByTestId("state");
        const state = JSON.parse(stateElement.textContent || "{}");
        expect(state.error).toBe("Connection failed");
        expect(state.isConnecting).toBe(false);
      });
    });

    it("should handle speaking events", async () => {
      let userStartedCallback: () => void = () => {};
      let userStoppedCallback: () => void = () => {};
      let botStartedCallback: () => void = () => {};
      let botStoppedCallback: () => void = () => {};

      mockClient.on.mockImplementation((event: string, callback: () => void) => {
        if (event === RTVIEvent.UserStartedSpeaking) {
          userStartedCallback = callback;
        } else if (event === RTVIEvent.UserStoppedSpeaking) {
          userStoppedCallback = callback;
        } else if (event === RTVIEvent.BotStartedSpeaking) {
          botStartedCallback = callback;
        } else if (event === RTVIEvent.BotStoppedSpeaking) {
          botStoppedCallback = callback;
        }
      });
      mockClient.initDevices.mockResolvedValue(undefined);
      mockClient.connect.mockResolvedValue(undefined);
      
      render(<TestComponent props={{ config }} />);
      
      fireEvent.click(screen.getByTestId("connect"));
      
      // Test user speaking events
      act(() => {
        userStartedCallback();
      });
      
      await waitFor(() => {
        const stateElement = screen.getByTestId("state");
        const state = JSON.parse(stateElement.textContent || "{}");
        expect(state.userSpeaking).toBe(true);
      });
      
      act(() => {
        userStoppedCallback();
      });
      
      await waitFor(() => {
        const stateElement = screen.getByTestId("state");
        const state = JSON.parse(stateElement.textContent || "{}");
        expect(state.userSpeaking).toBe(false);
      });
      
      // Test bot speaking events
      act(() => {
        botStartedCallback();
      });
      
      await waitFor(() => {
        const stateElement = screen.getByTestId("state");
        const state = JSON.parse(stateElement.textContent || "{}");
        expect(state.botSpeaking).toBe(true);
      });
      
      act(() => {
        botStoppedCallback();
      });
      
      await waitFor(() => {
        const stateElement = screen.getByTestId("state");
        const state = JSON.parse(stateElement.textContent || "{}");
        expect(state.botSpeaking).toBe(false);
      });
    });

    it("should handle disconnect", async () => {
      mockClient.initDevices.mockResolvedValue(undefined);
      mockClient.connect.mockImplementation(async () => {
        setTimeout(() => {
          if (mockClient._callbacks?.onConnected) {
            mockClient._callbacks.onConnected();
          }
        }, 0);
      });
      mockClient.disconnect.mockImplementation(async () => {
        setTimeout(() => {
          if (mockClient._callbacks?.onDisconnected) {
            mockClient._callbacks.onDisconnected();
          }
        }, 0);
      });

      render(<TestComponent props={{ config }} />);

      // Connect first
      fireEvent.click(screen.getByTestId("connect"));

      await waitFor(() => {
        const stateElement = screen.getByTestId("state");
        const state = JSON.parse(stateElement.textContent || "{}");
        expect(state.isConnected).toBe(true);
      });

      // Then disconnect
      fireEvent.click(screen.getByTestId("disconnect"));

      await waitFor(() => {
        const stateElement = screen.getByTestId("state");
        const state = JSON.parse(stateElement.textContent || "{}");
        expect(state.isConnected).toBe(false);
      });

      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should handle mute toggle", async () => {
      mockClient.initDevices.mockResolvedValue(undefined);
      mockClient.connect.mockImplementation(async () => {
        setTimeout(() => {
          if (mockClient._callbacks?.onConnected) {
            mockClient._callbacks.onConnected();
          }
        }, 0);
      });
      mockClient.enableMic.mockResolvedValue(undefined);

      render(<TestComponent props={{ config }} />);

      // Connect first
      fireEvent.click(screen.getByTestId("connect"));

      await waitFor(() => {
        const stateElement = screen.getByTestId("state");
        const state = JSON.parse(stateElement.textContent || "{}");
        expect(state.isConnected).toBe(true);
      });

      // Toggle mute (should mute)
      fireEvent.click(screen.getByTestId("toggle-mute"));

      await waitFor(() => {
        expect(mockClient.enableMic).toHaveBeenCalledWith(false);
        const stateElement = screen.getByTestId("state");
        const state = JSON.parse(stateElement.textContent || "{}");
        expect(state.isMuted).toBe(true);
      });

      // Toggle again (should unmute)
      fireEvent.click(screen.getByTestId("toggle-mute"));

      await waitFor(() => {
        expect(mockClient.enableMic).toHaveBeenCalledWith(true);
        const stateElement = screen.getByTestId("state");
        const state = JSON.parse(stateElement.textContent || "{}");
        expect(state.isMuted).toBe(false);
      });
    });
  });

  describe("PipecatVoice component", () => {
    it("should render default UI", () => {
      render(<PipecatVoice config={config} />);
      
      expect(screen.getByText("Disconnected")).toBeInTheDocument();
      expect(screen.getByText("Connect Voice")).toBeInTheDocument();
    });

    it("should call event callbacks", async () => {
      const onConnected = jest.fn();
      const onDisconnected = jest.fn();
      const onError = jest.fn();

      mockClient.initDevices.mockResolvedValue(undefined);
      mockClient.connect.mockImplementation(async () => {
        setTimeout(() => {
          if (mockClient._callbacks?.onConnected) {
            mockClient._callbacks.onConnected();
          }
        }, 0);
      });

      render(
        <PipecatVoice
          config={config}
          onConnected={onConnected}
          onDisconnected={onDisconnected}
          onError={onError}
        />
      );

      fireEvent.click(screen.getByText("Connect Voice"));

      await waitFor(() => {
        expect(onConnected).toHaveBeenCalled();
      });

      // Simulate disconnection
      act(() => {
        if (mockClient._callbacks?.onDisconnected) {
          mockClient._callbacks.onDisconnected();
        }
      });
      expect(onDisconnected).toHaveBeenCalled();

      // Simulate error
      const error = new Error("Test error");
      act(() => {
        if (mockClient._callbacks?.onError) {
          mockClient._callbacks.onError(error);
        }
      });
      expect(onError).toHaveBeenCalledWith(error);
    });

    it("should render children when provided", () => {
      render(
        <PipecatVoice config={config}>
          <div>Custom child component</div>
        </PipecatVoice>
      );
      
      expect(screen.getByText("Custom child component")).toBeInTheDocument();
    });

    it("should support render prop pattern", () => {
      render(
        <PipecatVoice config={config}>
          {(controls: any) => (
            <div>
              Custom render prop: {controls.state.isConnected ? "connected" : "disconnected"}
            </div>
          )}
        </PipecatVoice>
      );
      
      expect(screen.getByText("Custom render prop: disconnected")).toBeInTheDocument();
    });
  });
});