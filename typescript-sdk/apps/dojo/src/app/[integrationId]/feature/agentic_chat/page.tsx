"use client";
import React, { useState } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { CopilotKit, useCoAgent, useCopilotAction, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { PipecatVoice, type PipecatVoiceConfig } from "@ag-ui/pipecat/voice-client";

interface AgenticChatProps {
  params: Promise<{
    integrationId: string;
  }>;
}

const AgenticChat: React.FC<AgenticChatProps> = ({ params }) => {
  const { integrationId } = React.use(params);

  return (
    <CopilotKit
      runtimeUrl={`/api/copilotkit/${integrationId}`}
      showDevConsole={false}
      // agent lock to the relevant agent
      agent="agentic_chat"
    >
      <Chat integrationId={integrationId} />
    </CopilotKit>
  );
};

const Chat = ({ integrationId }: { integrationId: string }) => {
  const [background, setBackground] = useState<string>("--copilot-kit-background-color");

  useCopilotAction({
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
      setBackground(background);
      return {
        status: "success",
        message: `Background changed to ${background}`,
      };
    },
  });

  // Pipecat voice configuration  
  const pipecatConfig: PipecatVoiceConfig = {
    websocketUrl: "http://localhost:8765",
    timeout: 30000,
  };

  // Only show voice UI for Pipecat integration
  const showVoiceUI = integrationId === "pipecat";

  return (
    <div className="flex justify-center items-center h-full w-full" style={{ background }}>
      <div className="h-full w-full md:w-8/10 md:h-8/10 rounded-lg">
        {showVoiceUI ? (
          <PipecatVoice config={pipecatConfig}>
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
                            You're speaking
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
        ) : (
          <CopilotChat
            className="h-full rounded-2xl"
            labels={{ initial: "Hi, I'm an agent. Want to chat?" }}
          />
        )}
      </div>
    </div>
  );
};

export default AgenticChat;
