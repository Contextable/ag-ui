import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { agentsIntegrations } from "@/agents";

import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const integrationId = request.url.split("/").pop();
  console.log(`[CopilotKit API] Received request for integration: ${integrationId}`);

  const integration = agentsIntegrations.find((i) => i.id === integrationId);
  if (!integration) {
    console.log(`[CopilotKit API] Integration not found: ${integrationId}`);
    return new Response("Integration not found", { status: 404 });
  }
  
  // Log the request body to see what messages/tools are being sent
  const body = await request.text();
  const parsedBody = JSON.parse(body);
  console.log(`[CopilotKit API] Operation: ${parsedBody.operationName}`);
  if (parsedBody.variables?.data?.messages) {
    console.log(`[CopilotKit API] Messages count: ${parsedBody.variables.data.messages.length}`);
    parsedBody.variables.data.messages.forEach((msg: any, i: number) => {
      console.log(`[CopilotKit API] Message ${i}:`, {
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content?.substring(0, 100) + (msg.content?.length > 100 ? '...' : '') : JSON.stringify(msg.content),
        type: msg.__typename || 'unknown',
        raw: msg
      });
    });
  }
  
  // Create a new request with the same body for handleRequest
  const newRequest = new NextRequest(request.url, {
    method: request.method,
    headers: request.headers,
    body: body,
  });
  
  const agents = await integration.agents();
  const runtime = new CopilotRuntime({
    // @ts-ignore for now
    agents,
  });
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: `/api/copilotkit/${integrationId}`,
  });

  console.log(`[CopilotKit API] Forwarding request to runtime...`);
  
  try {
    const startTime = Date.now();
    const result = await handleRequest(newRequest);
    const endTime = Date.now();
    console.log(`[CopilotKit API] Request completed in ${endTime - startTime}ms`);
    return result;
  } catch (error) {
    console.error(`[CopilotKit API] Request failed:`, error);
    throw error;
  }
}
