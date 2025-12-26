# A2A Middleware Examples

This directory contains example A2A agents used by the A2A Middleware demo. **You must start these agents before using the A2A Chat feature in the Dojo app.**

## Prerequisites

1. Python 3.10+
2. Install dependencies:
   ```bash
   pip install a2a-sdk openai uvicorn
   ```
3. Set your OpenAI API key:
   ```bash
   export OPENAI_API_KEY='your-key-here'
   ```
4. Set your Google API key (for the orchestrator):
   ```bash
   export GOOGLE_API_KEY='your-key-here'
   ```

## Starting the Agents

You need to start **all four agents** in separate terminals:

### Terminal 1: Buildings Management Agent (Port 9001)
```bash
cd middlewares/a2a-middleware/examples
python buildings_management.py
```

### Terminal 2: Finance Agent (Port 9002)
```bash
cd middlewares/a2a-middleware/examples
python finance.py
```

### Terminal 3: IT Agent (Port 9003)
```bash
cd middlewares/a2a-middleware/examples
python it.py
```

### Terminal 4: Orchestrator Agent (Port 9000)
```bash
cd middlewares/a2a-middleware/examples
pip install ag-ui-adk google-adk  # Additional dependencies for orchestrator
python orchestrator.py
```

## Agent Descriptions

| Agent | Port | Description |
|-------|------|-------------|
| Buildings Management | 9001 | Handles office space, desk assignments, and meeting room bookings |
| Finance | 9002 | Manages ERP/payroll systems and financial operations |
| IT | 9003 | Handles IT infrastructure, account setup, and device provisioning |
| Orchestrator | 9000 | Routes requests between the specialized agents |

## Verifying Agents Are Running

You can verify each A2A agent is running by checking its AgentCard endpoint:

```bash
curl http://localhost:9001/.well-known/agent.json  # Buildings Management
curl http://localhost:9002/.well-known/agent.json  # Finance
curl http://localhost:9003/.well-known/agent.json  # IT
```

## Troubleshooting

**Error: AgentCards not found / Empty agent roster**
- Ensure all three A2A agents (ports 9001, 9002, 9003) are running before starting the Dojo app
- The A2A Middleware fetches AgentCards dynamically at startup from these endpoints

**Connection refused errors**
- Check that no other services are using ports 9000-9003
- Verify the agents started successfully without errors

**OpenAI API errors**
- Ensure `OPENAI_API_KEY` is set and valid
- The example agents use GPT-4o model

**Google API errors (Orchestrator)**
- Ensure `GOOGLE_API_KEY` is set and valid
- The orchestrator uses Gemini 2.5 Flash model
