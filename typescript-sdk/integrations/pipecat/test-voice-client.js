import { PipecatClient } from "@pipecat-ai/client-js";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";

async function testConnection() {
  console.log("Creating transport...");
  const transport = new WebSocketTransport();
  
  console.log("Creating client...");
  const client = new PipecatClient({
    transport,
    enableMic: true,
    enableCam: false,
  });

  console.log("Initializing devices...");
  await client.initDevices();

  console.log("Connecting with params:", {
    wsUrl: "ws://localhost:7860",
    timeout: 30000,
  });
  
  try {
    await client.connect({
      wsUrl: "ws://localhost:7860",
      timeout: 30000,
    });
    console.log("Connected successfully!");
  } catch (error) {
    console.error("Connection failed:", error);
  }
}

testConnection();