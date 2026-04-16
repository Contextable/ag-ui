"""FastAPI server exposing the Google Workspace agent at the root path.

Run with:
    uv run python -m ag_ui_google_workspace_agent.server
    # or
    uvicorn ag_ui_google_workspace_agent.server:app --host 0.0.0.0 --port 8001

Configure via env vars (see .env.example):
    GOOGLE_API_KEY      Gemini API key (or use Application Default Credentials)
    PORT                Port to bind (default: 8001)
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from ag_ui_adk import add_adk_fastapi_endpoint

from .agent import workspace_adk_agent


app = FastAPI(title="AG-UI Google Workspace Agent")
add_adk_fastapi_endpoint(app, workspace_adk_agent, path="/")


def main() -> None:
    import uvicorn

    google_api_key = os.getenv("GOOGLE_API_KEY")
    google_app_creds = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

    if not google_api_key and not google_app_creds:
        print("⚠️  Warning: No Google authentication credentials found!")
        print()
        print("   Google ADK uses environment variables for authentication:")
        print("   - API Key:")
        print("     export GOOGLE_API_KEY='your-api-key-here'")
        print("     Get a key from: https://makersuite.google.com/app/apikey")
        print()
        print("   - Or use Application Default Credentials (ADC):")
        print("     gcloud auth application-default login")
        print()

    port = int(os.getenv("PORT", "8001"))
    print(f"Starting AG-UI Google Workspace Agent on http://localhost:{port}/")
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
