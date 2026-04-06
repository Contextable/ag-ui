"use client";
import React from "react";
import "@copilotkit/react-core/v2/styles.css";
import "./style.css";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ integrationId: string }>;
}

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Recent cron runs",
        message:
          "Show me the results of the last 3 non-empty cron jobs run against the ag-ui-protocol repo.",
      },
      {
        title: "Today's runs",
        message: "What cron jobs ran today?",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat
      agentId="cron_report"
      className="h-full rounded-2xl max-w-6xl mx-auto"
    />
  );
}

export default function Page({ params }: PageProps) {
  const { integrationId } = React.use(params);

  return (
    <CopilotKit
      runtimeUrl={`/api/copilotkit/${integrationId}`}
      showDevConsole={false}
      agent="cron_report"
    >
      <div className="flex justify-center items-center h-full w-full">
        <div className="h-full w-full md:w-8/10 md:h-8/10 rounded-lg">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}
