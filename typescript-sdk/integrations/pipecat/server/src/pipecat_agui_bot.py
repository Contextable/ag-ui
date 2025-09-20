#!/usr/bin/env python3

"""
Pipecat AG-UI Bot with RTVI Integration

This is a complete Pipecat bot that integrates AG-UI streaming capabilities
using WebSocket transport and RTVI protocol components.

Usage:
    python pipecat_agui_bot.py

Environment Variables:
    OPENAI_API_KEY - Required for LLM
    CARTESIA_API_KEY - Required for TTS
    DEEPGRAM_API_KEY - Required for STT
    WEBSOCKET_HOST - WebSocket server host (default: 0.0.0.0)
    WEBSOCKET_PORT - WebSocket server port (default: 8765)
    HTTP_PORT - HTTP/SSE server port (default: 8000)
    DEBUG - Enable debug logging (default: false)

Installation:
    1. Copy .env.example to .env and configure your API keys
    2. pip install -r requirements.txt
    3. python pipecat_agui_bot.py

Endpoints:
    WebSocket (RTVI): ws://localhost:8765/ws
    HTTP/SSE (AG-UI): http://localhost:8000/sse
"""

import asyncio
import aiohttp
import os
import sys
import logging
import uvicorn
from typing import Dict, Any
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from ag_ui.core import RunAgentInput
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from pipecat.frames.frames import LLMMessagesFrame, EndFrame, StartInterruptionFrame
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.processors.frame_processor import FrameDirection
from pipecat.processors.frameworks.rtvi import RTVIProcessor, RTVIObserver, RTVIConfig
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.websocket.server import WebsocketServerTransport, WebsocketServerParams
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.frames.frames import TTSSpeakFrame, TTSAudioRawFrame, TTSTextFrame
from pipecat.processors.filters.function_filter import FunctionFilter
from pipecat.processors.frame_processor import FrameProcessor, Frame
from pipecat.utils.text.markdown_text_filter import MarkdownTextFilter  

# Import our AG-UI bridge
from agui_bridge import AGUIObserver
from agui_integration import AGUIRunProcessor

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PipecatAGUIBot:
    """
    A complete Pipecat bot with AG-UI integration using RTVI protocol.
    
    This bot creates a pipeline that includes:
    - WebSocket server transport for real-time communication
    - RTVI processor for client protocol handling
    - Deepgram STT for speech-to-text
    - OpenAI LLM for conversation
    - Cartesia TTS for text-to-speech
    - AG-UI bridge for streaming events to web clients
    - User response aggregation for conversation flow
    """
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.session: aiohttp.ClientSession = None
        self.agui_observer: AGUIObserver = AGUIObserver(
            debug=True,
            max_memory_mb=self.config.get("max_memory_mb", 100),
        )
        self.agui_processor: AGUIRunProcessor = AGUIRunProcessor(self.agui_observer)
        self.pipeline_task: PipelineTask = None  # Will be set when pipeline runs
        self.services: Dict[str, Any] = {}  # Will be set when services are created
        self.connection_filter: FunctionFilter = None  # Will be set when services are created
        self.tts_on: bool = False #TTS is off by default
        
        # Create FastAPI app for HTTP/SSE endpoint
        self.app = FastAPI(title="Pipecat AG-UI Bot")
        
        # Add CORS middleware to allow cross-origin requests from the Dojo frontend
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:3001", "http://localhost:3000", "*"],  # Allow Dojo and dev servers
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        @self.app.get("/health")
        async def health_check():
            """Health check endpoint for Railway"""
            return {"status": "healthy", "mode": os.getenv("WEBSOCKET_SERVER", "fast_api")}
        
        # Add RTVI root endpoint for voice connections
        @self.app.post("/")
        async def rtvi_endpoint(request: Request):
            # Return newer simplified RTVI format
            return {  
                "websocket_url": f"ws://localhost:{self.config.get('websocket_port', 8765)}",  
                "rtvi_version": "1.0.0",  
                "services": ["llm", "stt", "tts"],  
                "ready": True  
            }
        
        # Add SSE endpoint
        @self.app.post("/sse")
        async def sse_endpoint(input_data: RunAgentInput, request: Request):
            # Get the accept header from the request for proper content type handling
            accept_header = request.headers.get("accept")
            return StreamingResponse(
                await self.handle_agui_run(input_data, accept_header),
                media_type=self.agui_observer.encoder.get_content_type()
            )
        
    async def create_services(self):
        """Create and configure all pipeline services"""
        
        # Create HTTP session for AG-UI communication
        self.session = aiohttp.ClientSession()
        
        # WebSocket server transport
        ws_host = self.config.get("websocket_host", "0.0.0.0") 
        ws_port = self.config.get("websocket_port", 8765)
        logger.info(f"Creating WebSocket transport with host={ws_host}, port={ws_port}")
        transport = WebsocketServerTransport(
            params=WebsocketServerParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                add_wav_header=False,
                vad_analyzer=SileroVADAnalyzer(),
                serializer=ProtobufFrameSerializer(),
                path="/ws"
            ),
            host=ws_host,
            port=ws_port
        )
        # Debug the transport configuration
        logger.info(f"Transport params: {transport._params}")
        
        # RTVI configuration for client communication
        rtvi_config = RTVIConfig(config=[])
        
        # RTVI processor for client protocol handling
        rtvi = RTVIProcessor(config=rtvi_config)
        
        # Speech-to-text service
        stt = DeepgramSTTService(
            api_key=self.config["deepgram_api_key"]
        )
        
        # Language model service
        llm = OpenAILLMService(
            api_key=self.config["openai_api_key"],
            model="gpt-4o",
        )
        
        # Create the markdown filter  
        markdown_filter = MarkdownTextFilter() 

        # Text-to-speech service
        tts = CartesiaTTSService(
            api_key=self.config["cartesia_api_key"],
            voice_id="79a125e8-cd45-4c13-8a67-188112f4dd22", # British Lady
            text_filters=[markdown_filter] 
        )
        
        # Create context with system prompt - let context aggregator handle conversation history
        system_message = {
            "role": "system",
            "content": """You are a helpful AI assistant in a voice conversation. 
            You can see real-time updates about your conversation through the AG-UI interface.
            Keep your responses conversational and engaging. Respond to what the user said 
            in a natural way, but keep responses reasonably concise for voice interaction."""
        }
        
        context = OpenAILLMContext(messages=[system_message])
        context_aggregator = llm.create_context_aggregator(context)
        
        # Create WebSocket connection filter to prevent TTS when disconnected
        async def not_tts_frame(frame: Frame) -> bool:
            tts_types = (TTSSpeakFrame, TTSAudioRawFrame, TTSTextFrame)
            return self.tts_on or not isinstance(frame, tts_types)
        
        tts_filter = FunctionFilter(filter=not_tts_frame)
        self.connection_filter = tts_filter
        
        return {
            "transport": transport,
            "rtvi": rtvi,
            "stt": stt,
            "llm": llm,
            "tts": tts,
            "context": context,
            "context_aggregator": context_aggregator,
            "connection_filter": self.connection_filter
        }
    
    async def create_pipeline(self, services: Dict[str, Any]) -> Pipeline:
        """Create the main pipeline with RTVI integration"""
        
        # Create pipeline (AG-UI observer will watch via task observers)
        pipeline = Pipeline([
            services["transport"].input(),          # WebSocket audio input
            services["rtvi"],                       # RTVI protocol processor
            services["stt"],                        # Speech-to-text
            services["context_aggregator"].user(),  # User message context
            services["llm"],                        # Language model
            services["connection_filter"],          # Filter TTS when no WebSocket connection
            services["tts"],                        # Text-to-speech
            services["transport"].output(),         # WebSocket audio output
            services["context_aggregator"].assistant(),  # Assistant message context
        ])
        
        return pipeline
    
    def _get_system_prompt(self) -> dict:
        """Returns the initial system prompt for the LLM."""
        return {
            "role": "system",
            "content": """You are a helpful AI assistant in a voice conversation. 
            You can see real-time updates about your conversation through the AG-UI interface.
            Keep your responses conversational and engaging. Respond to what the user said 
            in a natural way, but keep responses reasonably concise for voice interaction."""
        }
    
    def convert_agui_tools_to_pipecat(self, agui_tools: list) -> ToolsSchema:
        """Convert AG-UI tool definitions into Pipecat format."""
        return self.agui_processor.convert_agui_tools_to_pipecat(agui_tools)

    async def register_tool_handlers(self, agui_tools: list, llm_service):
        """Register tool handlers with the LLM service."""
        await self.agui_processor.register_tool_handlers(agui_tools, llm_service)

    async def process_agui_input(self, input_data, services: Dict[str, Any], task: PipelineTask):
        """Process AG-UI RunAgentInput and queue Pipecat frames."""
        await self.agui_processor.process_agui_input(input_data, services, task)
    
    async def setup_rtvi_handlers(self, services: Dict[str, Any], task: PipelineTask):
        """Set up RTVI event handlers"""
        
        rtvi = services["rtvi"]
        
        @rtvi.event_handler("on_client_ready")
        async def on_client_ready(rtvi):
            """When RTVI client is ready, prepare for conversation"""
            logger.info("RTVI client ready")
            
            # Signal bot is ready to receive messages
            await rtvi.set_bot_ready()
            
            # Start AG-UI streaming
            await self.agui_observer._start_stream()
            
            # Don't trigger LLM generation here - let the client-side onConnected callback handle greeting
            logger.info(f"[CONTEXT] RTVI ready, waiting for client-side greeting trigger")
        
        # Note: RTVI processor doesn't have on_client_disconnect event
        # Client disconnect is handled by WebsocketServerTransport's on_client_disconnected event
    
    async def setup_transport_handlers(self, services: Dict[str, Any], task: PipelineTask):
        """Set up WebSocket transport event handlers"""
        
        transport = services["transport"]
        
        @transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            """When WebSocket client connects"""
            logger.info(f"WebSocket client connected: {client}")
            
            # Send StartInterruptionFrame to clear any ongoing processing
            logger.info("Sending StartInterruptionFrame to pipeline for new WebSocket connection")
            await task.queue_frame(StartInterruptionFrame())
            
            # Reset context aggregators for fresh conversation
            context_aggregator = services.get("context_aggregator")
            if context_aggregator:
                logger.info("Resetting context aggregators for new WebSocket connection")
                await context_aggregator.user().reset()
                await context_aggregator.assistant().reset()
            
            # Update connection filter to allow TTS
            self.tts_on = True
        
        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(transport, client):
            """When WebSocket client disconnects"""
            logger.info(f"WebSocket client disconnected: {client}")
            
            # Update connection filter to block TTS
            self.tts_on = False
            
            # End AG-UI streaming if not already ended
            if self.agui_observer.is_streaming:
                await self.agui_observer._end_stream({"reason": "websocket_disconnected"})
            
            # Don't end the pipeline - keep the server running for new connections
            # Just reset the conversation context for the next connection
            context = services.get("context")
            if context:
                context.set_messages([self._get_system_prompt()])
                logger.info("Conversation context reset for next connection")
    
    async def run(self):
        """Main bot execution"""
        try:
            logger.info("Starting Pipecat AG-UI Bot with RTVI...")
            
            # Create services
            services = await self.create_services()
            logger.info("Services created")
            
            # Create pipeline
            pipeline = await self.create_pipeline(services)
            logger.info("Pipeline created")
            
            # Create pipeline task with observers
            task = PipelineTask(
                pipeline,
                params=PipelineParams(
                    allow_interruptions=True,
                    enable_metrics=True,
                    enable_usage_metrics=True,
                    cancel_on_idle_timeout=False  # Prevents automatic cancellation
                ),
                idle_timeout_secs=None,  # Disable idle timeout completely
                observers=[
                    RTVIObserver(services["rtvi"]),  # RTVI observer
                    self.agui_observer  # AG-UI observer for SSE events
                ],
            )
            
            # Give the observer a reference back to the task it's observing
            self.agui_observer.pipeline_task = task
            
            # Store task and services for AG-UI input processing
            self.pipeline_task = task
            self.services = services
            
            # Start FastAPI server in background
            fastapi_task = asyncio.create_task(
                self._run_fastapi_server()
            )
            
            # Set up event handlers
            await self.setup_rtvi_handlers(services, task)
            await self.setup_transport_handlers(services, task)
            logger.info("Event handlers configured")
            
            # Note: AG-UI input will be processed via FastAPI endpoint
            
            # Log server info
            ws_host = self.config.get("websocket_host", "0.0.0.0")
            ws_port = self.config.get("websocket_port", 8765)
            http_port = self.config.get("http_port", 8000)
            logger.info(f"WebSocket server starting on {ws_host}:{ws_port}")
            logger.info(f"HTTP server starting on 0.0.0.0:{http_port}")
            logger.info("AG-UI SSE endpoint available at /sse")
            
            # Run the pipeline
            logger.info("Starting pipeline runner...")
            runner = PipelineRunner()
            await runner.run(task)
            
        except KeyboardInterrupt:
            logger.info("Bot interrupted by user")
        except Exception as e:
            logger.error(f"Bot error: {e}")
            raise
        finally:
            # Cleanup
            if 'fastapi_task' in locals():
                fastapi_task.cancel()
                try:
                    await fastapi_task
                except asyncio.CancelledError:
                    pass
            
            if self.session:
                await self.session.close()
            
            logger.info("Bot shutdown complete")
    
    async def handle_agui_run(self, input_data, accept_header=None):
        """
        Handle AG-UI RunAgentInput from FastAPI endpoint.
        This processes the input and returns an SSE stream of events.
        """
        if not self.pipeline_task or not self.services:
            raise RuntimeError("Bot not initialized. Call run() first.")
        
        # STEP 1: Detect if the client has reset the conversation.
        incoming_message_count = len(input_data.messages)
        if incoming_message_count < self.agui_observer.last_message_count:
            # Client-side reset detected!
            logger.info(f"Detected client reset: message count decreased from {self.agui_observer.last_message_count} to {incoming_message_count}")
            
            # 1. Perform a full reset of the observer's ID tracking.
            await self.agui_observer.full_reset(accept_header)
            
            # 2. Reset the LLM's conversation history using the context aggregator.
            logger.info("[CONTEXT] Client reset detected. Clearing LLM context.")
            context = self.services.get("context")
            if context:
                context.set_messages([self._get_system_prompt()])
                logger.info("[CONTEXT] Reset context messages to system prompt only")
        else:
            # Normal continuation of the conversation.
            await self.agui_observer.reset_for_new_run(accept_header)
        
        # STEP 2: Update the last message count for the next request.
        self.agui_observer.last_message_count = incoming_message_count
        
        # STEP 3: Process the AG-UI input into the pipeline
        await self.process_agui_input(input_data, self.services, self.pipeline_task)
        
        # STEP 4: Manually start the stream after the reset
        # This ensures the get_sse_stream() loop will start correctly.
        await self.agui_observer._start_stream()
        
        # STEP 5: Return the SSE stream. It will now start from a clean slate.
        return self.agui_observer.get_sse_stream()
    
    async def _run_fastapi_server(self):
        """Run FastAPI server for HTTP/SSE endpoint"""
        config = uvicorn.Config(
            app=self.app,
            host="0.0.0.0",
            port=int(os.environ.get("PORT", 8000)),
            log_level="info"
        )
        server = uvicorn.Server(config)
        await server.serve()


def load_config_from_env() -> Dict[str, Any]:
    """Load configuration from environment variables"""
    
    # Required environment variables
    required_vars = [
        "OPENAI_API_KEY",
        "CARTESIA_API_KEY", 
        "DEEPGRAM_API_KEY"
    ]
    
    config = {}
    missing_vars = []
    
    for var in required_vars:
        value = os.getenv(var)
        if not value:
            missing_vars.append(var)
        else:
            config[var.lower()] = value
    
    if missing_vars:
        logger.error(f"Missing required environment variables: {', '.join(missing_vars)}")
        sys.exit(1)
    
    # Optional environment variables
    config["agui_endpoint"] = os.getenv("AG_UI_ENDPOINT", "http://localhost:3000/api/ag-ui/stream")
    config["websocket_host"] = os.getenv("WEBSOCKET_HOST", "0.0.0.0")
    config["websocket_port"] = int(os.getenv("WEBSOCKET_PORT", "8765"))
    config["http_port"] = int(os.getenv("PORT", "8000"))
    config["debug"] = os.getenv("DEBUG", "false").lower() == "true"
    
    # Parse auth headers if provided
    agui_auth = os.getenv("AG_UI_AUTH_HEADERS")
    if agui_auth:
        try:
            import json
            config["agui_auth_headers"] = json.loads(agui_auth)
        except json.JSONDecodeError:
            logger.warning("Invalid AG_UI_AUTH_HEADERS format, ignoring")
            config["agui_auth_headers"] = {}
    else:
        config["agui_auth_headers"] = {}
    
    return config


async def main():
    """Main entry point"""
    
    # Load configuration
    config = load_config_from_env()
    
    logger.info("Configuration loaded:")
    for key, value in config.items():
        if "key" in key.lower() or "token" in key.lower():
            logger.info(f"  {key}: {'*' * len(str(value))}")
        else:
            logger.info(f"  {key}: {value}")
    
    # Create and run bot
    bot = PipecatAGUIBot(config)
    await bot.run()


if __name__ == "__main__":
    asyncio.run(main())
