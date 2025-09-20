"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { PipecatClient, PipecatClientOptions, RTVIEvent } from "@pipecat-ai/client-js";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";
import { PipecatVoiceConfig } from "./types";

export interface PipecatVoiceControls {
  state: PipecatVoiceState;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  toggleMute: () => void;
}

export interface PipecatVoiceProps {
  config: PipecatVoiceConfig;
  children?: React.ReactNode | ((controls: PipecatVoiceControls) => React.ReactNode);
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  onUserStartedSpeaking?: () => void;
  onUserStoppedSpeaking?: () => void;
  onBotStartedSpeaking?: () => void;
  onBotStoppedSpeaking?: () => void;
}

export interface PipecatVoiceState {
  isConnected: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  userSpeaking: boolean;
  botSpeaking: boolean;
  error?: string;
}

export const usePipecatVoice = (props: PipecatVoiceProps) => {
  const { config, onConnected, onDisconnected, onError, onUserStartedSpeaking, onUserStoppedSpeaking, onBotStartedSpeaking, onBotStoppedSpeaking } = props;
  
  const [state, setState] = useState<PipecatVoiceState>({
    isConnected: false,
    isConnecting: false,
    isMuted: false,
    userSpeaking: false,
    botSpeaking: false,
  });

  const clientRef = useRef<PipecatClient | null>(null);

  const connect = useCallback(async () => {
    if (clientRef.current || state.isConnecting) return;

    try {
      setState(prev => ({ ...prev, isConnecting: true, error: undefined }));

      const transport = new WebSocketTransport();
      
      const options: PipecatClientOptions = {
        transport,
        enableMic: config.enableMic ?? true,
        // Don't set baseUrl or endpoints.connect to bypass handshake for direct WebSocket connection
      };

      const client = new PipecatClient(options);

      // Set up event listeners
      client.on(RTVIEvent.Connected, () => {
        setState(prev => ({ ...prev, isConnected: true, isConnecting: false }));
        onConnected?.();
      });

      client.on(RTVIEvent.Disconnected, () => {
        setState(prev => ({ ...prev, isConnected: false, isConnecting: false }));
        onDisconnected?.();
      });

      client.on(RTVIEvent.Error, (message: any) => {
        const errorMsg = message?.data?.message || message?.message || 'Unknown error';
        const error = new Error(errorMsg);
        setState(prev => ({ ...prev, error: errorMsg, isConnecting: false }));
        onError?.(error);
      });

      client.on(RTVIEvent.UserStartedSpeaking, () => {
        setState(prev => ({ ...prev, userSpeaking: true }));
        onUserStartedSpeaking?.();
      });

      client.on(RTVIEvent.UserStoppedSpeaking, () => {
        setState(prev => ({ ...prev, userSpeaking: false }));
        onUserStoppedSpeaking?.();
      });

      client.on(RTVIEvent.BotStartedSpeaking, () => {
        setState(prev => ({ ...prev, botSpeaking: true }));
        onBotStartedSpeaking?.();
      });

      client.on(RTVIEvent.BotStoppedSpeaking, () => {
        setState(prev => ({ ...prev, botSpeaking: false }));
        onBotStoppedSpeaking?.();
      });

      clientRef.current = client;
      
      // Connect directly to WebSocket (bypassing HTTP handshake for local development)
      console.log('[PipecatVoice] Connecting directly to WebSocket:', config.websocketUrl);
      await client.connect({
        wsUrl: config.websocketUrl,
        endpoint: "http://localhost:8765",
        timeout: config.timeout,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[PipecatVoice] Connection error:', error);
      setState(prev => ({ ...prev, error: err.message, isConnecting: false }));
      onError?.(err);
    }
  }, [config, onConnected, onDisconnected, onError, onUserStartedSpeaking, onUserStoppedSpeaking, onBotStartedSpeaking, onBotStoppedSpeaking, state.isConnecting]);

  const disconnect = useCallback(async () => {
    if (!clientRef.current) return;

    try {
      await clientRef.current.disconnect();
      clientRef.current = null;
    } catch (error) {
      console.error("Error disconnecting RTVI client:", error);
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (!clientRef.current) return;

    try {
      const newMuteState = !state.isMuted;
      clientRef.current.enableMic(!newMuteState);
      setState(prev => ({ ...prev, isMuted: newMuteState }));
    } catch (error) {
      console.error("Error toggling mute:", error);
    }
  }, [state.isMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (clientRef.current && typeof clientRef.current.disconnect === 'function') {
        const disconnectPromise = clientRef.current.disconnect();
        if (disconnectPromise && typeof disconnectPromise.catch === 'function') {
          disconnectPromise.catch(console.error);
        }
      }
    };
  }, []);

  return {
    state,
    connect,
    disconnect,
    toggleMute,
  };
};

export const PipecatVoice: React.FC<PipecatVoiceProps> = ({ 
  children, 
  ...props 
}) => {
  const { state, connect, disconnect, toggleMute } = usePipecatVoice(props);

  if (children) {
    // Render prop pattern - pass voice controls to children
    if (typeof children === "function") {
      return children({ state, connect, disconnect, toggleMute });
    }
    return <>{children}</>;
  }

  // Default UI implementation
  return (
    <div className="pipecat-voice-controls">
      <div className="connection-status">
        {state.isConnecting && <span>Connecting...</span>}
        {state.isConnected && <span>Connected</span>}
        {!state.isConnected && !state.isConnecting && <span>Disconnected</span>}
        {state.error && <span className="error">Error: {state.error}</span>}
      </div>

      <div className="voice-indicators">
        {state.userSpeaking && <span className="speaking-indicator">🎤 You are speaking</span>}
        {state.botSpeaking && <span className="speaking-indicator">🔊 Bot is speaking</span>}
      </div>

      <div className="controls">
        {!state.isConnected ? (
          <button onClick={connect} disabled={state.isConnecting}>
            {state.isConnecting ? "Connecting..." : "Connect Voice"}
          </button>
        ) : (
          <>
            <button onClick={disconnect}>Disconnect</button>
            <button onClick={toggleMute} className={state.isMuted ? "muted" : ""}>
              {state.isMuted ? "🔇 Unmute" : "🔊 Mute"}
            </button>
          </>
        )}
      </div>
    </div>
  );
};