"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { PipecatClient, PipecatClientOptions, RTVIEvent } from "@pipecat-ai/client-js";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";
import { PipecatVoiceConfig } from "./types";
import { useCoAgent, useCopilotContext } from "@copilotkit/react-core";

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
  const botAudioRef = useRef<HTMLAudioElement | null>(null);
  

  const connect = useCallback(async () => {
    if (clientRef.current || state.isConnecting) return;

    try {
      setState(prev => ({ ...prev, isConnecting: true, error: undefined }));

      // Create audio element for bot playback if not exists
      if (!botAudioRef.current) {
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.volume = 0.7; // Lower volume to reduce microphone feedback
        document.body.appendChild(audio);
        botAudioRef.current = audio;
      }

      const transport = new WebSocketTransport();

      const handleConnected = () => {
        console.log('[PipecatVoice] Connected');
        setState(prev => ({ ...prev, isConnected: true, isConnecting: false }));
        onConnected?.();
      };

      const handleDisconnected = () => {
        console.log('[PipecatVoice] Disconnected');
        setState(prev => ({ ...prev, isConnected: false, isConnecting: false }));
        onDisconnected?.();
      };

      const handleError = (error: any) => {
        console.error('[PipecatVoice] Error:', error);
        const errorMsg = error?.message || 'Unknown error';
        setState(prev => ({ ...prev, error: errorMsg, isConnecting: false }));
        onError?.(new Error(errorMsg));
      };

      const options: PipecatClientOptions = {
        transport,
        enableMic: config.enableMic ?? true,
        enableCam: false,
        ...(({ user_llm_enabled: false }) as any), // Disable user-llm-text messages that cause WebSocket closure
        callbacks: {
          onConnected: handleConnected,
          onDisconnected: handleDisconnected,
          onBotReady: (data: any) => {
            console.log('[PipecatVoice] Bot ready:', data);
            setupMediaTracks();
          },
          onUserTranscript: (data: any) => {
            if (data.final) {
              console.log('[PipecatVoice] User:', data.text);
            }
          },
          onBotTranscript: (data: any) => {
            console.log('[PipecatVoice] Bot:', data.text);
          },
          onMessageError: (error: any) => {
            console.error('[PipecatVoice] Message error:', error);
            const errorMsg = error?.message || 'Message error';
            setState(prev => ({ ...prev, error: errorMsg }));
            onError?.(new Error(errorMsg));
          },
          onError: handleError,
        },
      };

      const client = new PipecatClient(options);

      client.on(RTVIEvent.Connected, handleConnected);
      client.on(RTVIEvent.Disconnected, handleDisconnected);
      client.on(RTVIEvent.Error, handleError);

      // Set up additional event listeners for speaking states with debugging
      client.on(RTVIEvent.UserStartedSpeaking, () => {
        console.log('[PipecatVoice] 🎤 UserStartedSpeaking event fired!');
        setState(prev => ({ ...prev, userSpeaking: true }));
        onUserStartedSpeaking?.();
      });

      client.on(RTVIEvent.UserStoppedSpeaking, () => {
        console.log('[PipecatVoice] 🎤 UserStoppedSpeaking event fired!');
        setState(prev => ({ ...prev, userSpeaking: false }));
        onUserStoppedSpeaking?.();
      });

      client.on(RTVIEvent.BotStartedSpeaking, () => {
        console.log('[PipecatVoice] 🔊 BotStartedSpeaking event fired!');
        setState(prev => ({ ...prev, botSpeaking: true }));
        onBotStartedSpeaking?.();
      });

      client.on(RTVIEvent.BotStoppedSpeaking, () => {
        console.log('[PipecatVoice] 🔊 BotStoppedSpeaking event fired!');
        setState(prev => ({ ...prev, botSpeaking: false }));
        onBotStoppedSpeaking?.();
      });

      // Set up track listeners for audio
      client.on(RTVIEvent.TrackStarted, (track: MediaStreamTrack, participant: any) => {
        console.log('[PipecatVoice] Track started:', track.kind, 'from', participant?.name);
        if (!participant?.local && track.kind === 'audio') {
          setupAudioTrack(track);
        }
      });

      client.on(RTVIEvent.TrackStopped, (track: MediaStreamTrack, participant: any) => {
        console.log('[PipecatVoice] Track stopped:', track.kind, 'from', participant?.name);
      });

      clientRef.current = client;

      // Setup helper functions
      const setupMediaTracks = () => {
        if (!client) return;
        const tracks = typeof client.tracks === "function" ? client.tracks() : undefined;
        if (tracks?.bot?.audio) {
          setupAudioTrack(tracks.bot.audio);
        }
      };

      const setupAudioTrack = (track: MediaStreamTrack) => {
        console.log('[PipecatVoice] Setting up audio track');
        if (!botAudioRef.current) return;
        
        // Check if we already have this track
        if (botAudioRef.current.srcObject && 'getAudioTracks' in botAudioRef.current.srcObject) {
          const oldTrack = (botAudioRef.current.srcObject as MediaStream).getAudioTracks()[0];
          if (oldTrack?.id === track.id) return;
        }
        
        botAudioRef.current.srcObject = new MediaStream([track]);
      };
      
      // Initialize devices when supported
      if (typeof (client as any).initDevices === "function") {
        await (client as any).initDevices();
      }

      const connectionOptions = {
        wsUrl: config.websocketUrl,
        timeout: config.timeout,
      };

      if (typeof (client as any).startBotAndConnect === "function") {
        await (client as any).startBotAndConnect(connectionOptions);
      } else if (typeof client.connect === "function") {
        await client.connect(connectionOptions);
      } else {
        throw new Error("Pipecat client does not support connect APIs");
      }
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
      
      // Clean up audio element
      if (botAudioRef.current) {
        if (botAudioRef.current.srcObject && 'getAudioTracks' in botAudioRef.current.srcObject) {
          (botAudioRef.current.srcObject as MediaStream).getAudioTracks().forEach(track => track.stop());
          botAudioRef.current.srcObject = null;
        }
        if (botAudioRef.current.parentNode) {
          botAudioRef.current.parentNode.removeChild(botAudioRef.current);
        }
        botAudioRef.current = null;
      }
    } catch (error) {
      console.error("Error disconnecting Pipecat client:", error);
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
      // Clean up audio element on unmount
      if (botAudioRef.current) {
        if (botAudioRef.current.srcObject && 'getAudioTracks' in botAudioRef.current.srcObject) {
          (botAudioRef.current.srcObject as MediaStream).getAudioTracks().forEach(track => track.stop());
        }
        if (botAudioRef.current.parentNode) {
          botAudioRef.current.parentNode.removeChild(botAudioRef.current);
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

// Simplified CopilotKit wrapper - the parent component handles triggering via proper CopilotKit APIs
const PipecatVoiceWithCopilot: React.FC<PipecatVoiceProps> = (props) => {
  // Just pass through the props - the parent component will handle AG-UI bridge triggering
  return <PipecatVoiceBase {...props} />;
};

// Base component without CopilotKit integration
const PipecatVoiceBase: React.FC<PipecatVoiceProps> = ({ 
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

// Error boundary to catch CopilotKit context errors
class CopilotKitErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    // Update state so the next render will show the fallback UI
    console.log('[PipecatVoice] CopilotKit Error Boundary caught error:', error?.message || error);
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.log('[PipecatVoice] CopilotKit Error Boundary details:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

// Smart wrapper that always tries CopilotKit first, falls back gracefully
export const PipecatVoice: React.FC<PipecatVoiceProps> = (props) => {
  return (
    <CopilotKitErrorBoundary fallback={<PipecatVoiceBase {...props} />}>
      <PipecatVoiceWithCopilot {...props} />
    </CopilotKitErrorBoundary>
  );
};