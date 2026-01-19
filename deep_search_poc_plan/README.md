# Deep Search POC - CopilotKit Implementation

A proof-of-concept implementation of [Google's ADK Deep Search sample](https://github.com/google/adk-samples/tree/main/python/agents/deep-search) using the [AG-UI Protocol](https://github.com/ag-ui-protocol/ag-ui) and [CopilotKit](https://copilotkit.ai).

## Overview

This project recreates the deep-search agent's functionality:
- **Multi-agent research pipeline** with planning, research, evaluation, and composition phases
- **Human-in-the-loop plan approval** allowing users to review and modify research objectives
- **Real-time progress tracking** with a visual timeline
- **Source tracking and citations** with inline clickable references
- **Iterative refinement loop** with quality evaluation

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │   Chat UI   │  │  Timeline   │  │   Sources   │  │   Plan     │ │
│  │ (CopilotKit)│  │  Component  │  │   Sidebar   │  │  Approval  │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘ │
│         │                │                │                │        │
│         └────────────────┴────────────────┴────────────────┘        │
│                                   │                                  │
│                          useCoagentState                            │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ AG-UI Protocol (SSE)
                                   │ - STATE_DELTA events
                                   │ - TEXT_MESSAGE events
                                   │ - TOOL_CALL events
┌──────────────────────────────────┴──────────────────────────────────┐
│                    Backend (FastAPI + ADK)                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    AG-UI ADK Middleware                       │  │
│  └──────────────────────────────┬───────────────────────────────┘  │
│                                 │                                   │
│  ┌──────────────────────────────┴───────────────────────────────┐  │
│  │              interactive_planner_agent (Root)                 │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │               research_pipeline (Sequential)             │ │  │
│  │  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────┐ │ │  │
│  │  │  │ Section   │ │ Section   │ │ Refinement│ │ Report   │ │ │  │
│  │  │  │ Planner   │→│ Researcher│→│ Loop      │→│ Composer │ │ │  │
│  │  │  └───────────┘ └───────────┘ └───────────┘ └──────────┘ │ │  │
│  │  └─────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 20+
- Google API Key (Gemini)

### Installation

```bash
# Clone the repository
git clone https://github.com/contextablemark/deep_search_poc.git
cd deep_search_poc

# Backend setup
cd backend
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt

# Frontend setup
cd ../frontend
npm install
```

### Configuration

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your API keys
GOOGLE_API_KEY=your_gemini_api_key
```

### Running

```bash
# Terminal 1: Start backend
cd backend
uvicorn src.main:app --reload --port 8000

# Terminal 2: Start frontend
cd frontend
npm run dev
```

Visit http://localhost:3000 to use the application.

## Documentation

- [Implementation Plan](./IMPLEMENTATION_PLAN.md) - Detailed architecture and component designs
- [frontend/src/lib/types.ts](./frontend/src/lib/types.ts) - TypeScript type definitions

## Key Features

### Human-in-the-Loop Plan Approval

Users can review, modify, and approve research plans before execution:

```tsx
useHumanInTheLoop({
  name: "approve_research_plan",
  render: ({ args, respond }) => (
    <PlanApproval
      plan={args.plan}
      onApprove={(plan) => respond({ approved: true, plan })}
      onReject={(feedback) => respond({ approved: false, feedback })}
    />
  ),
});
```

### Real-time State Synchronization

Research state flows from backend to frontend via AG-UI protocol:

```tsx
const { state } = useCoagentState<ResearchState>();
// state.phase, state.sources, state.report_sections, etc.
```

### Citation Management

Sources are tracked with short IDs and rendered as clickable citations:

```
Research shows that [src-1] climate change affects [src-2] biodiversity...
```

## Project Structure

```
deep_search_poc/
├── backend/
│   └── src/
│       ├── main.py              # FastAPI app
│       ├── agents/              # ADK agent definitions
│       ├── callbacks/           # State and citation callbacks
│       └── state/               # Pydantic models
├── frontend/
│   └── src/
│       ├── app/                 # Next.js pages
│       ├── components/          # React components
│       ├── hooks/               # Custom hooks
│       └── lib/                 # Types and utilities
└── docker-compose.yml           # Local development
```

## License

MIT
