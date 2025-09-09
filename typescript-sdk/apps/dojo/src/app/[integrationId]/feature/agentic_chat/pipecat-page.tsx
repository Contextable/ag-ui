"use client";
import React, { useState, useRef } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { CopilotKit, useCoAgent, useCopilotAction, useCopilotChat } from "@copilotkit/react-core";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import { CopilotChat } from "@copilotkit/react-ui";
import { PipecatVoice, type PipecatVoiceConfig } from "@ag-ui/pipecat/voice-client";

interface AgenticChatProps {
  params: Promise<{
    integrationId: string;
  }>;
}

export const PipecatAgenticChat: React.FC<AgenticChatProps> = ({ params }) => {
  const { integrationId } = React.use(params);

  return (
    <CopilotKit
      runtimeUrl={`/api/copilotkit/${integrationId}`}
      showDevConsole={false}
      // agent lock to the relevant agent
      agent="agentic_chat"
    >
      <PipecatChat integrationId={integrationId} />
    </CopilotKit>
  );
};

const PipecatChat = ({ integrationId }: { integrationId: string }) => {
  const [background, setBackground] = useState<string>("--copilot-kit-background-color");
  const [isClient, setIsClient] = useState(false);
  const [isRunActive, setIsRunActive] = useState(false);
  
  // Use a ref for immediate synchronous blocking of concurrent requests
  const isRunActiveRef = useRef(false);

  const { appendMessage, isLoading } = useCopilotChat();
  
  // Connect to the agent - this is critical for tool execution!
  useCoAgent({
    name: "agentic_chat",
  });

  // Track loading state transitions for completion detection
  const prevIsLoadingRef = useRef(isLoading);

  // Monitor loading state transitions to detect conversation completion
  React.useEffect(() => {
    console.log("[COPILOT_DEBUG] CopilotKit isLoading changed:", isLoading);
    
    // Detect transition from not loading to loading (request started)
    if (!prevIsLoadingRef.current && isLoading) {
      console.log('[LOADING_TRANSITION] Started loading - setting isRunActive = true');
      setIsRunActive(true);
      isRunActiveRef.current = true;
    }
    // Detect transition from loading to not loading (completion)
    else if (prevIsLoadingRef.current && !isLoading) {
      console.log('[LOADING_TRANSITION] Detected transition from loading to not-loading');
      
      // Additional logic to distinguish between natural completion vs abort/error
      // If we have an active run and loading just finished, it's likely natural completion
      if (isRunActive || isRunActiveRef.current) {
        console.log('[RUN_STATE] Conversation completed naturally - resetting isRunActive');
        setIsRunActive(false);
        isRunActiveRef.current = false;
      } else {
        console.log('[LOADING_TRANSITION] Loading finished but no active run (likely error/abort)');
      }
    }
    
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, isRunActive]);

  // Only render on client side to avoid SSR issues with CopilotKit
  React.useEffect(() => {
    setIsClient(true);
  }, []);

  // Monitor CopilotKit GraphQL requests to see if tool calls are being processed
  React.useEffect(() => {
    if (!isClient) return;

    const originalFetch = window.fetch;
    window.fetch = function(url: RequestInfo | URL, options?: RequestInit) {
      const urlStr = typeof url === 'string' ? url : url.toString();
      
      if (urlStr.includes('/api/copilotkit/')) {
        console.log('[COPILOT_DEBUG] CopilotKit request:', { url: urlStr, options });
        
        return originalFetch(url, options).then(response => {
          console.log('[COPILOT_DEBUG] CopilotKit response:', { 
            url: urlStr, 
            status: response.status,
            headers: Object.fromEntries(response.headers.entries())
          });
          return response;
        });
      }
      
      return originalFetch(url, options);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [isClient]);

  // Add console logging to debug CopilotKit context
  console.log('[PipecatChat] Component rendering, integrationId:', integrationId, 'isClient:', isClient);

  // PHASE 4: Voice callback functions with aggressive state management
  const triggerAgentRun = React.useCallback(async (message: string) => {
    const isEmpty = !message || message.trim() === '';
    console.log('[TRIGGER] Sending Developer message:', isEmpty ? 'EMPTY' : `"${message}"`);
    
    // Set run active IMMEDIATELY when starting the request, not when we get RUN_STARTED back
    setIsRunActive(true);
    isRunActiveRef.current = true; // Immediate synchronous update
    console.log('[RUN_STATE] Setting isRunActive = true (request started)');
    
    try {
      await appendMessage(new TextMessage({
        content: message,
        role: Role.Developer,
      }));
      console.log('[TRIGGER] Developer message sent successfully');
    } catch (error) {
      console.error('[TRIGGER] Error sending developer message:', error);
      // Reset run state if the request failed
      setIsRunActive(false);
      isRunActiveRef.current = false;
      console.log('[RUN_STATE] Setting isRunActive = false (request failed)');
    }
  }, [appendMessage]);

  const handleVoiceTrigger = React.useCallback(() => {
    // Check the ref first for immediate synchronous blocking
    if (isRunActiveRef.current) {
      console.log('[VOICE_TRIGGER] Ignoring voice trigger - run already active (ref check)');
      return;
    }
    
    // Also check state as backup
    if (isRunActive || isLoading) {
      console.log('[VOICE_TRIGGER] Ignoring voice trigger - run already active (state check)');
      return;
    }
    
    console.log('[VOICE_TRIGGER] Starting new run from voice trigger');
    triggerAgentRun('');
  }, [isRunActive, isLoading, triggerAgentRun]);

  const copilotAction = useCopilotAction({
    name: "change_background",
    description:
      "Change the background color of the chat. Can be anything that the CSS background attribute accepts. Regular colors, linear of radial gradients etc.",
    parameters: [
      {
        name: "background",
        type: "string",
        description: "The background. Prefer gradients.",
      },
    ],
    handler: ({ background }) => {
      console.log('[TOOL_HANDLER] change_background called with:', background);
      setBackground(background);
      const result = {
        status: "success",
        message: `Background changed to ${background}`,
      };
      console.log('[TOOL_HANDLER] change_background returning:', result);
      return result;
    },
  });

  // Debug the action registration
  React.useEffect(() => {
    console.log('[COPILOT_DEBUG] useCopilotAction registered:', {
      name: 'change_background',
      action: copilotAction
    });
  }, [copilotAction]);

  // Pipecat voice configuration  
  const pipecatConfig: PipecatVoiceConfig = {
    websocketUrl: "ws://localhost:8765/ws",
    //websocketUrl: "wss://respectful-inspiration-production-fc90.up.railway.app/ws",
    timeout: 30000,
  };


  // Show loading state during SSR
  if (!isClient) {
    return (
      <div className="flex justify-center items-center h-full w-full" style={{ background }}>
        <div className="h-full w-full md:w-8/10 md:h-8/10 rounded-lg">
          <div className="flex justify-center items-center h-full">
            <div className="text-lg">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center h-full w-full" style={{ background }}>
      <div className="h-full w-full md:w-8/10 md:h-8/10 rounded-lg">
        <PipecatVoice 
          config={pipecatConfig}
          onConnected={() => {
            console.log('[CALLBACK] onConnected fired - sending greeting trigger');
            triggerAgentRun('User is connected and ready to speak. Please greet them and let them know you can hear them.');
          }}
          onUserStartedSpeaking={() => {
            console.log('[CALLBACK] onUserStartedSpeaking fired - simple trigger');
            handleVoiceTrigger();
          }}
        >
          {(controls) => (
            <div className="h-full flex flex-col">
              {/* Voice Controls Bar */}
              <div className="bg-white/90 backdrop-blur p-4 rounded-t-2xl border-b flex items-center gap-4">
                <button
                  onClick={controls.state.isConnected ? controls.disconnect : controls.connect}
                  disabled={controls.state.isConnecting}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    controls.state.isConnected 
                      ? "bg-red-500 hover:bg-red-600 text-white"
                      : controls.state.isConnecting
                      ? "bg-gray-400 text-white cursor-not-allowed"
                      : "bg-green-500 hover:bg-green-600 text-white"
                  }`}
                >
                  {controls.state.isConnecting ? "Connecting..." : controls.state.isConnected ? "Disconnect" : "Connect Voice"}
                </button>
                
                {controls.state.isConnected && (
                  <>
                    <button
                      onClick={controls.toggleMute}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        controls.state.isMuted
                          ? "bg-gray-500 hover:bg-gray-600 text-white"
                          : "bg-blue-500 hover:bg-blue-600 text-white"
                      }`}
                    >
                      {controls.state.isMuted ? "Unmute" : "Mute"}
                    </button>
                    
                    <div className="flex items-center gap-2 ml-auto">
                      {controls.state.userSpeaking && (
                        <span className="text-sm bg-green-100 text-green-700 px-2 py-1 rounded">
                          You&apos;re speaking
                        </span>
                      )}
                      {controls.state.botSpeaking && (
                        <span className="text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded">
                          Bot is speaking
                        </span>
                      )}
                    </div>
                  </>
                )}
                
                {controls.state.error && (
                  <span className="text-red-600 text-sm ml-2">{controls.state.error}</span>
                )}
              </div>
              
              {/* Chat Interface */}
              <div className="flex-1">
                <CopilotChat
                  className="h-full rounded-b-2xl"
                  labels={{ initial: "Hi, I'm an agent. Want to chat or speak?" }}
                />
              </div>
            </div>
          )}
        </PipecatVoice>
      </div>
    </div>
  );
};

export default PipecatAgenticChat;