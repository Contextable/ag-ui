"""Custom FastAPI route that pulls a user id from a request header.

This example shows how to keep the default ADK route while adding a
custom route that injects a header value (``x-user-id``) into the
``RunAgentInput.state`` before forwarding the request to the ADK agent.
The ``user_id_extractor`` reads the injected value so session handling can
still use the custom user id.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from ag_ui.core import EventType, RunAgentInput, RunErrorEvent
from ag_ui.encoder import EventEncoder
from google.adk.agents import LlmAgent


def user_id_extractor(input_data: RunAgentInput) -> str:
    """Pull the user id from state when present."""
    if input_data.state and "user_id" in input_data.state:
        return str(input_data.state["user_id"])
    return "anonymous"


# Create a sample ADK agent (this would be your actual agent)
sample_agent = LlmAgent(
    name="assistant",
    model="gemini-2.0-flash",
    instruction="""
    You are a helpful assistant. You should respond succinctly while
    honoring the requested user id when it is provided.
    """,
)

# Create ADK middleware agent instance
chat_agent = ADKAgent(
    adk_agent=sample_agent,
    app_name="demo_app",
    user_id_extractor=user_id_extractor,
    session_timeout_seconds=3600,
    use_in_memory_services=True,
)

# Create FastAPI app
app = FastAPI(title="ADK Middleware Header-based User Id")

# Keep the default ADK endpoint for reference
add_adk_fastapi_endpoint(app, chat_agent, path="/")


async def stream_agent_response(input_data: RunAgentInput, request: Request) -> StreamingResponse:
    """Mirror the built-in ADK endpoint's streaming behavior.

    A generator is still required because the ADK agent yields a stream of
    protocol events; this helper just keeps the streaming logic in one place so
    both routes can share it.
    """

    encoder = EventEncoder(accept=request.headers.get("accept"))

    async def event_generator():
        try:
            async for event in chat_agent.run(input_data):
                yield encoder.encode(event)
        except Exception as agent_error:
            error_event = RunErrorEvent(
                type=EventType.RUN_ERROR,
                message=f"Agent execution failed: {agent_error}",
                code="AGENT_ERROR",
            )
            yield encoder.encode(error_event)

    return StreamingResponse(event_generator(), media_type=encoder.get_content_type())


@app.post("/with-header")
async def chat_with_header(input_data: RunAgentInput, request: Request):
    """ADK route that adds ``x-user-id`` into state before running the agent."""

    # Copy the incoming state to avoid mutating pydantic internals in place
    input_state = dict(input_data.state or {})

    header_user_id = request.headers.get("x-user-id")
    if header_user_id:
        input_state["user_id"] = header_user_id
        input_data.state = input_state

    return await stream_agent_response(input_data, request)
