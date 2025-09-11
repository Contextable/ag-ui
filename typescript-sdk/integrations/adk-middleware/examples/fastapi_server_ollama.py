#!/usr/bin/env python

"""Example FastAPI server using ADK middleware.

This example shows how to use the ADK middleware with FastAPI.
Note: Requires google.adk to be installed and configured.
"""

import uvicorn
import logging
import httpx
import json
from fastapi import FastAPI
from .tool_based_generative_ui.agent import haiku_generator_agent
from .human_in_the_loop.agent import human_in_loop_agent
from .shared_state.agent import shared_state_agent
from .predictive_state_updates.agent import predictive_state_updates_agent

# Basic logging configuration
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
LOGGER = logging.getLogger(__name__)

headers = {
    "X-Webhook-Token": "09021212896ca945394c027f77234aec",
    "Content-Type": "application/json"
}

async def call_external_get_api(url, params=None):
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params = params, timeout=60.0, headers=headers)
        response.raise_for_status()
        return response.json()
    

async def lookup_trips() -> str:
    """This tool is used to retrieve a list of upcoming trips from TripIt.  
    It can contain any number of objects such as hotels, flights, restaurant reservations, rental car reservations, tours, etc. .

    Args:
        None

    Returns:
        A clean, summarized JSON string of upcoming trips, including any associated flight and lodging details.
    """
    # Let's rename for clarity, since it's not a "raw" string anymore
    response_data = await call_external_get_api("https://tripit-wrapper-mefinsf.replit.app/get_trips?userid=mefogle@gmail.com")

    # This check is still important in case the API call fails
    if not response_data:
        print("Error: API call returned an empty response.") 
        return "Failed to retrieve trip data. The external service returned no information."

    # --- MAIN FIX ---
    # The response is already a dictionary, so we can use it directly.
    # We just need to get the 'content' dictionary from inside it.
    data = response_data.get("content", {})
    if not data:
        return "Failed to process trip data. The response was missing the main 'content' section."
    # --- END OF FIX ---

    # 2. Extract the relevant top-level objects. Use .get() for safety.
    trips_raw = data.get("Trip", [])
    flights_raw = data.get("AirObject", [])
    lodgings_raw = data.get("LodgingObject", [])
    
    LOGGER.info("trips_raw: %s", trips_raw)
    LOGGER.info("flights_raw: %s",flights_raw)
    LOGGER.info("lodgings_raw: %s",lodgings_raw)

    # 3. Create maps for easy lookup of flights and lodgings by trip_id
    flights_by_trip_id = {}
    for flight in flights_raw:
        trip_id = flight.get("trip_id")
        if trip_id not in flights_by_trip_id:
            flights_by_trip_id[trip_id] = []
        
        simple_segments = []
        
        # Get the segment data, which could be a dict or a list
        segment_data = flight.get("Segment")

        # --- SOLUTION: Normalize segment_data into a list ---
        segment_list = []
        if isinstance(segment_data, dict):
            # If it's a single dictionary, put it into a list
            segment_list = [segment_data]
        elif isinstance(segment_data, list):
            # If it's already a list, use it directly
            segment_list = segment_data

        # Now, you can safely loop over segment_list because it's guaranteed to be a list
        for segment in segment_list:
            if isinstance(segment, dict): # A final safety check
                simple_segments.append({
                    "from": segment.get("start_airport_code"),
                    "to": segment.get("end_airport_code"),
                    "airline": segment.get("marketing_airline"),
                    "flight_number": segment.get("marketing_flight_number")
                })

    flights_by_trip_id[trip_id].extend(simple_segments)

    lodgings_by_trip_id = {}
    for lodging in lodgings_raw:
        trip_id = lodging.get("trip_id")
        if trip_id not in lodgings_by_trip_id:
            lodgings_by_trip_id[trip_id] = []
        
        # Simplify the lodging data
        lodgings_by_trip_id[trip_id].append({
            "name": lodging.get("display_name"),
            "check_in": lodging.get("StartDateTime", {}).get("date"),
            "check_out": lodging.get("EndDateTime", {}).get("date")
        })

    # 4. Build the final, clean list of trips
    processed_trips = []
    for trip in trips_raw:
        trip_id = trip.get("id")
        processed_trips.append({
            "name": trip.get("display_name"),
            "location": trip.get("primary_location"),
            "start_date": trip.get("start_date"),
            "end_date": trip.get("end_date"),
            "flights": flights_by_trip_id.get(trip_id, []),
            "lodging": lodgings_by_trip_id.get(trip_id, [])
        })

    # 5. Return the clean data as a JSON string
    LOGGER.info("processed_trips: %s", processed_trips)
    return json.dumps(processed_trips, indent=2)



# These imports will work once google.adk is available
try:
    # from src.adk_agent import ADKAgent
    # from src.agent_registry import AgentRegistry
    # from src.endpoint import add_adk_fastapi_endpoint

    from adk_middleware import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk import tools as adk_tools
    from google.adk.models.lite_llm import LiteLlm
    
    # Create a sample ADK agent (this would be your actual agent)
    sample_agent = LlmAgent(
        name="assistant",
        model=LiteLlm(model="ollama_chat/qwen3:8b"),
        instruction="You are a helpful assistant. Help users by answering their questions and assisting with their needs. When formatting your response, eliminate excess punctuation and format your responses in a conversational manner. Also, you *must* exclude any <think> </think> elements.  /no_think",
        tools=[adk_tools.preload_memory_tool.PreloadMemoryTool(), lookup_trips]
    )
    # Create ADK middleware agent instances with direct agent references
    chat_agent = ADKAgent(
        adk_agent=sample_agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True
    )
    
    adk_agent_haiku_generator = ADKAgent(
        adk_agent=haiku_generator_agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True
    )
    
    adk_human_in_loop_agent = ADKAgent(
        adk_agent=human_in_loop_agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True
    )
    
    adk_shared_state_agent = ADKAgent(
        adk_agent=shared_state_agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True
    )
    
    adk_predictive_state_agent = ADKAgent(
        adk_agent=predictive_state_updates_agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True
    )
    
    # Create FastAPI app
    app = FastAPI(title="ADK Middleware Demo")
    
    # Add the ADK endpoint
    add_adk_fastapi_endpoint(app, chat_agent, path="/chat")
    add_adk_fastapi_endpoint(app, adk_agent_haiku_generator, path="/adk-tool-based-generative-ui")
    add_adk_fastapi_endpoint(app, adk_human_in_loop_agent, path="/adk-human-in-loop-agent")
    add_adk_fastapi_endpoint(app, adk_shared_state_agent, path="/adk-shared-state-agent")
    add_adk_fastapi_endpoint(app, adk_predictive_state_agent, path="/adk-predictive-state-agent")
    
    @app.get("/")
    async def root():
        return {"message": "ADK Middleware is running!", "endpoint": "/chat"}
    
    if __name__ == "__main__":
        print("Starting ADK Middleware server...")
        print("Chat endpoint available at: http://localhost:8000/chat")
        print("API docs available at: http://localhost:8000/docs")
        uvicorn.run(app, host="0.0.0.0", port=8000)
        
except ImportError as e:
    print(f"Cannot run server: {e}")
    print("Please install google.adk and ensure all dependencies are available.")
    print("\nTo install dependencies:")
    print("  pip install google-adk")
    print("  # Note: google-adk may not be publicly available yet")