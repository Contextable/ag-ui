# A2A Middleware

This middleware enables multi-agent orchestration using the [A2A (Agent-to-Agent) protocol](https://github.com/google/A2A). It acts as a bridge between the AG-UI frontend and multiple A2A-compatible agents.

## How It Works

The A2A Middleware:
1. Connects to multiple remote A2A agents at startup
2. Fetches their AgentCards to discover capabilities
3. Uses an orchestration agent to route user requests to the appropriate specialized agents
4. Handles multi-turn conversations between agents

## Running the Demo

### Prerequisites

Before using the A2A Chat feature in the Dojo app, you must start the example backend agents.

See **[examples/README.md](./examples/README.md)** for detailed setup instructions.

### Quick Start

```bash
# 1. Install Python dependencies
cd middlewares/a2a-middleware/examples
pip install -r requirements.txt

# 2. Set environment variables
export OPENAI_API_KEY='your-openai-key'
export GOOGLE_API_KEY='your-google-key'

# 3. Start all agents (each in a separate terminal)
python buildings_management.py  # Port 9001
python finance.py               # Port 9002
python it.py                    # Port 9003
python orchestrator.py          # Port 9000

# 4. Start the Dojo app and navigate to the A2A integration
```

## Architecture

```
User → Dojo App (Frontend)
         ↓
    A2AMiddlewareAgent
         ↓
    Orchestrator Agent (ADK/Gemini) - Port 9000
         ├→ Buildings Management Agent (A2A) - Port 9001
         ├→ Finance Agent (A2A) - Port 9002
         └→ IT Agent (A2A) - Port 9003
```

## Tutorial

To learn how to set up your own middleware server, please refer to the [tutorial](https://docs.ag-ui.com/quickstart/middleware).
