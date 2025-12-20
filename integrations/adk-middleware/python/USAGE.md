# ADK Middleware Usage Guide

This guide provides detailed usage instructions and configuration options for the ADK Middleware.

## Configuration Options

### App and User Identification

```python
# Static app name and user ID (single-tenant apps)
agent = ADKAgent(
    adk_agent=my_agent,
    app_name="my_app", 
    user_id="static_user"
)

# Dynamic extraction from context (recommended for multi-tenant)
def extract_app(input: RunAgentInput) -> str:
    # Extract from context
    for ctx in input.context:
        if ctx.description == "app":
            return ctx.value
    return "default_app"

def extract_user(input: RunAgentInput) -> str:
    # Extract from context
    for ctx in input.context:
        if ctx.description == "user":
            return ctx.value
    return f"anonymous_{input.thread_id}"

agent = ADKAgent(
    adk_agent=my_agent,
    app_name_extractor=extract_app,
    user_id_extractor=extract_user
)
```

### Session Management

Session management is handled automatically by the singleton `SessionManager`. The middleware uses sensible defaults, but you can configure session behavior if needed by accessing the session manager directly:

```python
from ag_ui_adk.session_manager import SessionManager

# Session management is automatic, but you can access the manager if needed
session_mgr = SessionManager.get_instance()

# Create your ADK agent normally
agent = ADKAgent(
    app_name="my_app",
    user_id="user123",
    use_in_memory_services=True
)
```

### Service Configuration

```python
# Development (in-memory services) - Default
agent = ADKAgent(
    app_name="my_app",
    user_id="user123",
    use_in_memory_services=True  # Default behavior
)

# Production with custom services
agent = ADKAgent(
    app_name="my_app", 
    user_id="user123",
    artifact_service=GCSArtifactService(),
    memory_service=VertexAIMemoryService(),  
    credential_service=SecretManagerService(),
    use_in_memory_services=False
)
```

### Automatic Session Memory

When you provide a `memory_service`, the middleware automatically preserves expired sessions in ADK's memory service before deletion. This enables powerful conversation history and context retrieval features.

```python
from google.adk.memory import VertexAIMemoryService

# Enable automatic session memory
agent = ADKAgent(
    app_name="my_app",
    user_id="user123", 
    memory_service=VertexAIMemoryService(),  # Sessions auto-saved here on expiration
    use_in_memory_services=False
)

# Now when sessions expire (default 20 minutes), they're automatically:
# 1. Added to memory via memory_service.add_session_to_memory()
# 2. Then deleted from active session storage
# 3. Available for retrieval and context in future conversations
```

## Memory Tools Integration

To enable memory functionality in your ADK agents, you need to add Google ADK's memory tools to your agents (not to the ADKAgent middleware):

```python
from google.adk.agents import Agent
from google.adk import tools as adk_tools

# Create agent with memory tools - THIS IS CORRECT
my_agent = Agent(
    name="assistant",
    model="gemini-2.0-flash", 
    instruction="You are a helpful assistant.",
    tools=[adk_tools.preload_memory_tool.PreloadMemoryTool()]  # Add memory tools here
)

# Create middleware with direct agent embedding
adk_agent = ADKAgent(
    adk_agent=my_agent,
    app_name="my_app",
    user_id="user123",
    memory_service=shared_memory_service  # Memory service enables automatic session memory
)
```

**⚠️ Important**: The `tools` parameter belongs to the ADK agent (like `Agent` or `LlmAgent`), **not** to the `ADKAgent` middleware. The middleware automatically handles any tools defined on the embedded agents.

**Testing Memory Workflow:**

1. Start a conversation and provide information (e.g., "My name is John")
2. Wait for session timeout + cleanup interval (up to 90 seconds with testing config: 60s timeout + up to 30s for next cleanup cycle)
3. Start a new conversation and ask about the information ("What's my name?").
4. The agent should remember the information from the previous session.

## Examples

### Simple Conversation

```python
import asyncio
from ag_ui_adk import ADKAgent
from google.adk.agents import Agent
from ag_ui.core import RunAgentInput, UserMessage

async def main():
    # Setup
    my_agent = Agent(name="assistant", instruction="You are a helpful assistant.")
    
    agent = ADKAgent(
        adk_agent=my_agent,
        app_name="demo_app", 
        user_id="demo"
    )
    
    # Create input
    input = RunAgentInput(
        thread_id="thread_001",
        run_id="run_001",
        messages=[
            UserMessage(id="1", role="user", content="Hello!")
        ],
        context=[],
        state={},
        tools=[],
        forwarded_props={}
    )
    
    # Run and handle events
    async for event in agent.run(input):
        print(f"Event: {event.type}")
        if hasattr(event, 'delta'):
            print(f"Content: {event.delta}")

asyncio.run(main())
```

### Passing Initial State

Pass frontend state to initialize the ADK session before the agent runs:

```python
input = RunAgentInput(
    thread_id="session_001",
    run_id="run_001",
    state={
        "selected_document": "doc-456",
        "user_preferences": {"language": "en", "theme": "dark"},
        "context": {"project_id": "proj-123"}
    },
    messages=[
        UserMessage(id="1", role="user", content="Summarize the selected document")
    ],
    context=[],
    tools=[],
    forwarded_props={}
)

# The agent can now access state.selected_document, state.user_preferences, etc.
async for event in agent.run(input):
    print(f"Event: {event.type}")
```

The `state` field:
- Initializes ADK session state on first request for a `thread_id`
- Syncs/merges with existing state on subsequent requests
- Is accessible to ADK agent tools via `context.session.state`

### Multi-Agent Setup

```python
# Create multiple agent instances with different ADK agents
general_agent_wrapper = ADKAgent(
    adk_agent=general_agent,
    app_name="demo_app",
    user_id="demo"
)

technical_agent_wrapper = ADKAgent(
    adk_agent=technical_agent,
    app_name="demo_app",
    user_id="demo"
)

creative_agent_wrapper = ADKAgent(
    adk_agent=creative_agent,
    app_name="demo_app",
    user_id="demo"
)

# Use different endpoints for each agent
from fastapi import FastAPI
from ag_ui_adk import add_adk_fastapi_endpoint

app = FastAPI()
add_adk_fastapi_endpoint(app, general_agent_wrapper, path="/agents/general")
add_adk_fastapi_endpoint(app, technical_agent_wrapper, path="/agents/technical")
add_adk_fastapi_endpoint(app, creative_agent_wrapper, path="/agents/creative")
```

### Example: wrap an existing ADK agent

The middleware does not accept model/tool/instruction parameters directly—configure them on your ADK agent first, then pass the fully built agent into `ADKAgent`. The haiku generator example server demonstrates this pattern end-to-end:

```python
from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from fastapi import FastAPI
from google.adk.agents import Agent
from google.genai import types

haiku_generator_agent = Agent(
    model="gemini-2.5-flash",
    name="haiku_generator_agent",
    instruction="""
        You are an expert haiku generator that creates beautiful Japanese haiku poems
        and their English translations. You also have the ability to select relevant
        images that complement the haiku's theme and mood.
    """,
    generate_content_config=types.GenerateContentConfig(
        temperature=0.7,
        top_p=0.9,
        top_k=40,
    ),
)

adk_agent = ADKAgent(
    adk_agent=haiku_generator_agent,  # Pre-configured ADK agent instance
    app_name="demo_app",
    user_id="demo_user",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
)

app = FastAPI(title="ADK Middleware Tool Based Generative UI")
add_adk_fastapi_endpoint(app, adk_agent, path="/")
```

You can run this example directly from `examples/server/api/tool_based_generative_ui.py` to see how the wrapped agent preserves your model and instruction choices while the middleware handles AG-UI protocol translation.

### Example: include ADK agent plugins

`ADKAgent` forwards any plugins you attach to the underlying ADK agent. Configure the plugins on the ADK side, then wrap the agent as usual:

```python
from ag_ui_adk import ADKAgent
from google.adk import plugins as adk_plugins
from google.adk.agents import Agent


class AuditTrailPlugin(adk_plugins.Plugin):
    """Example plugin that logs the model request and response."""

    async def before_run(self, context):
        request = context.run_config.model_request
        print(f"[audit] user={context.user_id} model_request={request}")

    async def after_run(self, context, result):
        print(f"[audit] completion tokens={result.metrics.get('completion_tokens', 0)}")


haiku_generator_agent = Agent(
    model="gemini-2.5-flash",
    name="haiku_generator_agent",
    instruction="Write seasonal haiku and return both Japanese and English lines.",
    plugins=[AuditTrailPlugin()],  # Plugins are configured on the ADK agent itself
)

adk_agent = ADKAgent(
    adk_agent=haiku_generator_agent,
    app_name="demo_app",
    user_id="demo_user",
)
```

The middleware does not need to know about `plugins`—they are invoked by the ADK runtime because they are attached to your base agent.

## Event Translation

The middleware translates between AG-UI and ADK event formats:

| AG-UI Event | ADK Event | Description |
|-------------|-----------|-------------|
| TEXT_MESSAGE_* | Event with content.parts[].text | Text messages |
| RUN_STARTED/FINISHED | Runner lifecycle | Execution flow |

## Message History Features

### MESSAGES_SNAPSHOT Emission

You can configure the middleware to emit a `MESSAGES_SNAPSHOT` event at the end of each run, containing the full conversation history:

```python
agent = ADKAgent(
    adk_agent=my_agent,
    app_name="my_app",
    user_id="user123",
    emit_messages_snapshot=True  # Emit full message history at run end
)
```

When enabled, the middleware will:
1. Extract all events from the ADK session at the end of each run
2. Convert them to AG-UI message format
3. Emit a `MESSAGES_SNAPSHOT` event with the complete conversation history

This is useful for clients that need to persist conversation history or for AG-UI protocol compliance.

### Converting ADK Events to Messages

The `adk_events_to_messages()` function is available for direct use if you need to convert ADK session events to AG-UI messages:

```python
from ag_ui_adk import adk_events_to_messages

# Get events from an ADK session
session = await session_service.get_session(session_id, app_name, user_id)
messages = adk_events_to_messages(session.events)

# messages is a list of AG-UI Message objects (UserMessage, AssistantMessage, ToolMessage)
```

### Experimental: /agents/state Endpoint

**WARNING: This endpoint is experimental and subject to change in future versions.**

When using `add_adk_fastapi_endpoint()`, an additional `POST /agents/state` endpoint is automatically added. This endpoint allows front-end frameworks to retrieve thread state and message history on-demand, without initiating a new agent run.

**Request:**
```json
{
  "threadId": "thread_123",
  "name": "optional_agent_name",
  "properties": {}
}
```

**Response:**
```json
{
  "threadId": "thread_123",
  "threadExists": true,
  "state": "{\"key\": \"value\"}",
  "messages": "[{\"id\": \"1\", \"role\": \"user\", \"content\": \"Hello\"}]"
}
```

Note: The `state` and `messages` fields are JSON-stringified for compatibility with front-end frameworks that expect this format.

**Example usage:**
```python
import httpx

async def get_thread_history(thread_id: str):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://localhost:8000/agents/state",
            json={"threadId": thread_id}
        )
        data = response.json()
        if data["threadExists"]:
            import json
            messages = json.loads(data["messages"])
            state = json.loads(data["state"])
            return messages, state
        return [], {}
```

## Additional Resources

- For configuration options, see [CONFIGURATION.md](./CONFIGURATION.md)
- For architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md)
- For development setup, see the main [README.md](./README.md)
- For API documentation, refer to the source code docstrings