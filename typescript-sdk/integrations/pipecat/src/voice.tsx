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
  const botAudioRef = useRef<HTMLAudioElement | null>(null);

  const connect = useCallback(async () => {
    if (clientRef.current || state.isConnecting) return;

    try {
      setState(prev => ({ ...prev, isConnecting: true, error: undefined }));

      // Create audio element for bot playback if not exists
      if (!botAudioRef.current) {
        const audio = document.createElement('audio');
        audio.autoplay = true;
        document.body.appendChild(audio);
        botAudioRef.current = audio;
      }

      const transport = new WebSocketTransport();
      
      const options: PipecatClientOptions = {
        transport,
        enableMic: config.enableMic ?? true,
        enableCam: false,
        callbacks: {
          onConnected: () => {
            console.log('[PipecatVoice] Connected');
            setState(prev => ({ ...prev, isConnected: true, isConnecting: false }));
            onConnected?.();
          },
          onDisconnected: () => {
            console.log('[PipecatVoice] Disconnected');
            setState(prev => ({ ...prev, isConnected: false, isConnecting: false }));
            onDisconnected?.();
          },
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
          onError: (error: any) => {
            console.error('[PipecatVoice] Error:', error);
            const errorMsg = error?.message || 'Unknown error';
            setState(prev => ({ ...prev, error: errorMsg, isConnecting: false }));
            onError?.(new Error(errorMsg));
          },
        },
      };

      const client = new PipecatClient(options);

      // Set up additional event listeners for speaking states
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
        const tracks = client.tracks();
        if (tracks.bot?.audio) {
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
      
      // Initialize devices and connect
      await client.initDevices();
      await client.connect({ 
        wsUrl: config.websocketUrl
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