# Deep Search POC - CopilotKit Implementation Plan

## Overview

This document outlines the implementation plan for recreating Google's ADK deep-search sample using AG-UI protocol and CopilotKit as the frontend framework.

## Project Structure

```
deep_search_poc/
├── backend/
│   ├── pyproject.toml
│   ├── requirements.txt
│   └── src/
│       ├── __init__.py
│       ├── main.py                    # FastAPI app entry point
│       ├── config.py                  # Research configuration
│       ├── agents/
│       │   ├── __init__.py
│       │   ├── root_agent.py          # interactive_planner_agent
│       │   ├── section_planner.py     # Report outline generator
│       │   ├── section_researcher.py  # Web research executor
│       │   ├── research_evaluator.py  # Quality assessment
│       │   ├── enhanced_search.py     # Refinement searches
│       │   └── report_composer.py     # Final synthesis with citations
│       ├── tools/
│       │   ├── __init__.py
│       │   └── search.py              # Google search tool wrapper
│       ├── callbacks/
│       │   ├── __init__.py
│       │   ├── sources.py             # Source collection callback
│       │   └── citations.py           # Citation replacement callback
│       └── state/
│           ├── __init__.py
│           └── models.py              # Pydantic state models
│
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx               # Main research interface
│       │   ├── globals.css
│       │   └── api/
│       │       └── copilotkit/
│       │           └── route.ts       # CopilotKit runtime endpoint
│       ├── components/
│       │   ├── research-chat.tsx      # Main chat wrapper
│       │   ├── plan-approval.tsx      # Human-in-the-loop plan UI
│       │   ├── research-timeline.tsx  # Progress visualization
│       │   ├── source-sidebar.tsx     # Discovered sources panel
│       │   ├── citation-message.tsx   # Message with inline citations
│       │   └── effort-selector.tsx    # Model/effort configuration
│       ├── hooks/
│       │   ├── use-research-state.ts  # Research state subscription
│       │   └── use-sources.ts         # Source tracking hook
│       └── lib/
│           ├── types.ts               # TypeScript types
│           └── utils.ts               # Utility functions
│
├── docker-compose.yml                 # Local dev environment
├── .env.example
└── README.md
```

---

## Phase 1: Backend Architecture

### 1.1 FastAPI + AG-UI ADK Middleware Setup

**File: `backend/src/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint

from .agents.root_agent import create_root_agent
from .config import ResearchConfig

app = FastAPI(title="Deep Search POC")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create the ADK agent hierarchy
root_agent = create_root_agent()

# Wrap with AG-UI middleware
deep_search_agent = ADKAgent(
    adk_agent=root_agent,
    app_name="deep_search",
    user_id="default_user"
)

# Register the AG-UI endpoint
add_adk_fastapi_endpoint(
    app,
    deep_search_agent,
    path="/research",
    extract_headers=["x-effort-level", "x-model-preference"]
)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

### 1.2 Agent Hierarchy Design

The agent hierarchy mirrors the original deep-search structure:

```
interactive_planner_agent (LlmAgent) - ROOT
│
├── [Phase 1: Planning]
│   └── Generates research plan, handles user refinement
│
└── research_pipeline (SequentialAgent)
    │
    ├── section_planner (LlmAgent)
    │   └── Creates report outline from approved plan
    │
    ├── section_researcher (LlmAgent)
    │   └── Executes initial research with google_search
    │
    ├── iterative_refinement_loop (LoopAgent, max_iterations=3)
    │   ├── research_evaluator (LlmAgent)
    │   │   └── Grades research quality, identifies gaps
    │   ├── escalation_checker (custom BaseAgent)
    │   │   └── Triggers escalation on "pass" grade
    │   └── enhanced_search_executor (LlmAgent)
    │       └── Executes follow-up searches
    │
    └── report_composer (LlmAgent)
        └── Synthesizes final report with citations
```

**File: `backend/src/agents/root_agent.py`**

```python
from google.adk.agents import LlmAgent, SequentialAgent, LoopAgent
from google.adk.tools import google_search

from .section_planner import create_section_planner
from .section_researcher import create_section_researcher
from .research_evaluator import create_research_evaluator
from .escalation_checker import EscalationChecker
from .enhanced_search import create_enhanced_search_executor
from .report_composer import create_report_composer
from ..callbacks.sources import collect_research_sources_callback
from ..callbacks.citations import citation_replacement_callback

def create_root_agent():
    """Create the complete deep search agent hierarchy."""

    # Create the iterative refinement loop
    refinement_loop = LoopAgent(
        name="iterative_refinement_loop",
        max_iterations=3,
        sub_agents=[
            create_research_evaluator(),
            EscalationChecker(name="escalation_checker"),
            create_enhanced_search_executor(),
        ]
    )

    # Create the research pipeline
    research_pipeline = SequentialAgent(
        name="research_pipeline",
        sub_agents=[
            create_section_planner(),
            create_section_researcher(),
            refinement_loop,
            create_report_composer(),
        ]
    )

    # Create root agent with HITL capability
    root_agent = LlmAgent(
        name="interactive_planner_agent",
        model="gemini-2.0-flash",
        instruction=PLANNER_INSTRUCTION,
        tools=[google_search],
        sub_agents=[research_pipeline],
        before_agent_callback=collect_research_sources_callback,
        after_agent_callback=citation_replacement_callback,
    )

    return root_agent

PLANNER_INSTRUCTION = """
You are a research planning assistant. Your role is to:

1. Understand the user's research topic
2. Generate a comprehensive research plan with tagged objectives:
   - [RESEARCH] - Primary research tasks
   - [DELIVERABLE] - Expected outputs
   - [MODIFIED] - User-modified objectives
   - [NEW] - Newly added objectives
   - [IMPLIED] - Inferred supporting tasks

3. Present the plan to the user for approval
4. Refine based on user feedback
5. Once approved, delegate to research_pipeline for execution

Always wait for explicit user approval before proceeding with research.
"""
```

### 1.3 State Models

**File: `backend/src/state/models.py`**

```python
from pydantic import BaseModel
from typing import List, Dict, Optional
from enum import Enum

class ResearchPhase(str, Enum):
    PLANNING = "planning"
    AWAITING_APPROVAL = "awaiting_approval"
    RESEARCHING = "researching"
    EVALUATING = "evaluating"
    REFINING = "refining"
    COMPOSING = "composing"
    COMPLETE = "complete"

class ResearchObjective(BaseModel):
    description: str
    tag: str  # RESEARCH, DELIVERABLE, MODIFIED, NEW, IMPLIED
    status: str = "pending"  # pending, approved, rejected, completed

class ResearchPlan(BaseModel):
    topic: str
    objectives: List[ResearchObjective]
    approved: bool = False

class Source(BaseModel):
    url: str
    title: str
    domain: str
    short_id: str  # e.g., "src-1"
    supported_claims: List[str] = []
    confidence: float = 1.0

class ReportSection(BaseModel):
    title: str
    content: str
    sources: List[str] = []  # List of short_ids

class ResearchState(BaseModel):
    """Complete research state synced to frontend via AG-UI."""
    phase: ResearchPhase = ResearchPhase.PLANNING
    research_plan: Optional[ResearchPlan] = None
    report_sections: List[ReportSection] = []
    section_research_findings: Dict[str, str] = {}
    research_evaluation: Optional[Dict] = None
    sources: Dict[str, Source] = {}  # short_id -> Source
    current_iteration: int = 0
    max_iterations: int = 3
    final_report: Optional[str] = None
```

### 1.4 Source Collection Callback

**File: `backend/src/callbacks/sources.py`**

```python
from google.adk.agents import CallbackContext
from ..state.models import Source

def collect_research_sources_callback(ctx: CallbackContext):
    """Extract grounding metadata from search results."""

    # Initialize sources dict if not present
    if "sources" not in ctx.state:
        ctx.state["sources"] = {}
    if "url_to_short_id" not in ctx.state:
        ctx.state["url_to_short_id"] = {}

    # Check for grounding metadata in the event
    event = ctx.event
    if hasattr(event, 'grounding_metadata'):
        for result in event.grounding_metadata.get('search_results', []):
            url = result.get('url')
            if url and url not in ctx.state["url_to_short_id"]:
                short_id = f"src-{len(ctx.state['sources']) + 1}"
                ctx.state["url_to_short_id"][url] = short_id
                ctx.state["sources"][short_id] = Source(
                    url=url,
                    title=result.get('title', url),
                    domain=extract_domain(url),
                    short_id=short_id,
                    confidence=result.get('confidence', 1.0)
                ).model_dump()

    # Emit state delta to frontend
    ctx.emit_state_delta([
        {"op": "replace", "path": "/sources", "value": ctx.state["sources"]}
    ])

def extract_domain(url: str) -> str:
    from urllib.parse import urlparse
    return urlparse(url).netloc
```

---

## Phase 2: Frontend Architecture

### 2.1 CopilotKit Setup

**File: `frontend/src/app/api/copilotkit/route.ts`**

```typescript
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

// Remote agent endpoint pointing to our FastAPI backend
const RESEARCH_AGENT_URL = process.env.RESEARCH_AGENT_URL || "http://localhost:8000/research";

export const POST = async (req: Request) => {
  const runtime = new CopilotRuntime({
    remoteEndpoints: [
      {
        url: RESEARCH_AGENT_URL,
        onBeforeRequest: async ({ body }) => {
          // Add any custom headers or transformations
          return {
            ...body,
            forwarded_props: {
              effort_level: body.forwarded_props?.effort_level || "medium",
            },
          };
        },
      },
    ],
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
```

### 2.2 Main Research Interface

**File: `frontend/src/app/page.tsx`**

```tsx
"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { ResearchChat } from "@/components/research-chat";
import { SourceSidebar } from "@/components/source-sidebar";
import { ResearchTimeline } from "@/components/research-timeline";
import { EffortSelector } from "@/components/effort-selector";
import { useState } from "react";

export default function DeepSearchPage() {
  const [effortLevel, setEffortLevel] = useState<"low" | "medium" | "high">("medium");

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="interactive_planner_agent"
      properties={{ effort_level: effortLevel }}
    >
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        {/* Left: Research Timeline */}
        <aside className="w-64 border-r border-gray-200 dark:border-gray-700 p-4">
          <ResearchTimeline />
        </aside>

        {/* Center: Chat Interface */}
        <main className="flex-1 flex flex-col">
          <header className="border-b border-gray-200 dark:border-gray-700 p-4">
            <h1 className="text-xl font-semibold">Deep Search</h1>
            <EffortSelector value={effortLevel} onChange={setEffortLevel} />
          </header>
          <ResearchChat />
        </main>

        {/* Right: Source Sidebar */}
        <aside className="w-80 border-l border-gray-200 dark:border-gray-700">
          <SourceSidebar />
        </aside>
      </div>
    </CopilotKit>
  );
}
```

### 2.3 Research Chat with Human-in-the-Loop

**File: `frontend/src/components/research-chat.tsx`**

```tsx
"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import { useHumanInTheLoop } from "@copilotkit/react-core";
import { PlanApproval } from "./plan-approval";
import { CitationMessage } from "./citation-message";
import "@copilotkit/react-ui/styles.css";

export function ResearchChat() {
  // Register human-in-the-loop for plan approval
  useHumanInTheLoop({
    name: "approve_research_plan",
    description: "Present research plan for user approval",
    parameters: [
      {
        name: "plan",
        type: "object",
        attributes: [
          { name: "topic", type: "string" },
          {
            name: "objectives",
            type: "object[]",
            attributes: [
              { name: "description", type: "string" },
              { name: "tag", type: "string" },
              { name: "status", type: "string" },
            ],
          },
        ],
      },
    ],
    render: ({ args, respond, status }) => (
      <PlanApproval
        plan={args.plan}
        status={status}
        onApprove={(modifiedPlan) => respond({ approved: true, plan: modifiedPlan })}
        onReject={(feedback) => respond({ approved: false, feedback })}
      />
    ),
  });

  return (
    <div className="flex-1 overflow-hidden">
      <CopilotChat
        className="h-full"
        instructions="You are a deep research assistant. Help users explore topics thoroughly."
        labels={{
          initial: "What would you like to research today?",
          placeholder: "Enter a research topic or question...",
        }}
        makeSystemMessage={(msg) => (
          <CitationMessage content={msg.content} />
        )}
      />
    </div>
  );
}
```

### 2.4 Plan Approval Component (Human-in-the-Loop)

**File: `frontend/src/components/plan-approval.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ResearchPlan, ResearchObjective } from "@/lib/types";

interface PlanApprovalProps {
  plan: ResearchPlan;
  status: "executing" | "complete" | "inProgress";
  onApprove: (plan: ResearchPlan) => void;
  onReject: (feedback: string) => void;
}

export function PlanApproval({ plan, status, onApprove, onReject }: PlanApprovalProps) {
  const [localPlan, setLocalPlan] = useState<ResearchPlan>(plan);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  const toggleObjective = (index: number) => {
    setLocalPlan((prev) => ({
      ...prev,
      objectives: prev.objectives.map((obj, i) =>
        i === index
          ? { ...obj, status: obj.status === "approved" ? "rejected" : "approved" }
          : obj
      ),
    }));
  };

  const addObjective = () => {
    const description = prompt("Enter new research objective:");
    if (description) {
      setLocalPlan((prev) => ({
        ...prev,
        objectives: [
          ...prev.objectives,
          { description, tag: "NEW", status: "approved" },
        ],
      }));
    }
  };

  const handleApprove = () => {
    onApprove({
      ...localPlan,
      approved: true,
      objectives: localPlan.objectives.filter((o) => o.status === "approved"),
    });
  };

  const handleReject = () => {
    if (feedback.trim()) {
      onReject(feedback);
    } else {
      setShowFeedback(true);
    }
  };

  const isDisabled = status !== "executing";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 max-w-2xl">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          Research Plan
        </h2>
        <p className="text-gray-600 dark:text-gray-300 mt-1">
          Topic: <span className="font-medium">{localPlan.topic}</span>
        </p>
      </div>

      {/* Objectives List */}
      <div className="space-y-3 mb-6">
        {localPlan.objectives.map((objective, index) => (
          <ObjectiveItem
            key={index}
            objective={objective}
            onToggle={() => toggleObjective(index)}
            disabled={isDisabled}
          />
        ))}
      </div>

      {/* Add Objective Button */}
      <button
        onClick={addObjective}
        disabled={isDisabled}
        className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-gray-600
                   rounded-lg text-gray-500 dark:text-gray-400 hover:border-blue-400
                   hover:text-blue-500 transition-colors disabled:opacity-50"
      >
        + Add Research Objective
      </button>

      {/* Feedback Input */}
      {showFeedback && (
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="What changes would you like to make?"
          className="w-full mt-4 p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          rows={3}
        />
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 mt-6">
        <button
          onClick={handleReject}
          disabled={isDisabled}
          className="flex-1 py-3 px-4 bg-gray-200 dark:bg-gray-700 text-gray-700
                     dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300
                     dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
        >
          {showFeedback ? "Submit Feedback" : "Request Changes"}
        </button>
        <button
          onClick={handleApprove}
          disabled={isDisabled}
          className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium
                     hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          Approve & Start Research
        </button>
      </div>
    </div>
  );
}

function ObjectiveItem({
  objective,
  onToggle,
  disabled,
}: {
  objective: ResearchObjective;
  onToggle: () => void;
  disabled: boolean;
}) {
  const tagColors: Record<string, string> = {
    RESEARCH: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    DELIVERABLE: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    MODIFIED: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    NEW: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    IMPLIED: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  };

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg transition-all ${
        objective.status === "approved"
          ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
          : "bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
      }`}
    >
      <input
        type="checkbox"
        checked={objective.status === "approved"}
        onChange={onToggle}
        disabled={disabled}
        className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600
                   focus:ring-blue-500 disabled:opacity-50"
      />
      <div className="flex-1">
        <p
          className={`${
            objective.status !== "approved" ? "line-through text-gray-400" : ""
          }`}
        >
          {objective.description}
        </p>
      </div>
      <span className={`px-2 py-1 rounded text-xs font-medium ${tagColors[objective.tag]}`}>
        {objective.tag}
      </span>
    </div>
  );
}
```

### 2.5 Research Timeline Component

**File: `frontend/src/components/research-timeline.tsx`**

```tsx
"use client";

import { useCoagentState } from "@copilotkit/react-core";
import { ResearchPhase } from "@/lib/types";

const PHASES: { key: ResearchPhase; label: string; icon: string }[] = [
  { key: "planning", label: "Planning", icon: "📋" },
  { key: "awaiting_approval", label: "Awaiting Approval", icon: "⏳" },
  { key: "researching", label: "Researching", icon: "🔍" },
  { key: "evaluating", label: "Evaluating", icon: "📊" },
  { key: "refining", label: "Refining", icon: "🔄" },
  { key: "composing", label: "Composing Report", icon: "📝" },
  { key: "complete", label: "Complete", icon: "✅" },
];

export function ResearchTimeline() {
  const { state } = useCoagentState<{
    phase: ResearchPhase;
    current_iteration: number;
    max_iterations: number;
  }>();

  const currentPhase = state?.phase || "planning";
  const currentIndex = PHASES.findIndex((p) => p.key === currentPhase);

  return (
    <div className="space-y-2">
      <h2 className="font-semibold text-gray-700 dark:text-gray-200 mb-4">
        Research Progress
      </h2>

      <div className="space-y-1">
        {PHASES.map((phase, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isPending = index > currentIndex;

          return (
            <div
              key={phase.key}
              className={`flex items-center gap-3 p-2 rounded-lg transition-all ${
                isCurrent
                  ? "bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700"
                  : isComplete
                    ? "bg-green-50 dark:bg-green-900/20"
                    : "opacity-50"
              }`}
            >
              <span className="text-lg">{phase.icon}</span>
              <span
                className={`text-sm ${
                  isCurrent
                    ? "font-medium text-blue-700 dark:text-blue-300"
                    : isComplete
                      ? "text-green-700 dark:text-green-400 line-through"
                      : "text-gray-500"
                }`}
              >
                {phase.label}
              </span>
              {isCurrent && (
                <span className="ml-auto">
                  <span className="animate-pulse w-2 h-2 bg-blue-500 rounded-full inline-block" />
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Iteration Counter (for refinement phase) */}
      {(currentPhase === "evaluating" || currentPhase === "refining") && (
        <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Refinement Iteration
          </p>
          <p className="text-lg font-semibold">
            {state?.current_iteration || 0} / {state?.max_iterations || 3}
          </p>
        </div>
      )}
    </div>
  );
}
```

### 2.6 Source Sidebar Component

**File: `frontend/src/components/source-sidebar.tsx`**

```tsx
"use client";

import { useCoagentState } from "@copilotkit/react-core";
import { Source } from "@/lib/types";
import { ExternalLink } from "lucide-react";

export function SourceSidebar() {
  const { state } = useCoagentState<{ sources: Record<string, Source> }>();

  const sources = state?.sources ? Object.values(state.sources) : [];
  const sortedSources = [...sources].sort(
    (a, b) => parseInt(a.short_id.split("-")[1]) - parseInt(b.short_id.split("-")[1])
  );

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="font-semibold text-gray-700 dark:text-gray-200">
          Sources Discovered
        </h2>
        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
          {sources.length}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {sortedSources.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Sources will appear here as research progresses...
          </p>
        ) : (
          sortedSources.map((source) => (
            <SourceCard key={source.short_id} source={source} />
          ))
        )}
      </div>
    </div>
  );
}

function SourceCard({ source }: { source: Source }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200
                 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600
                 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            {source.short_id}
          </p>
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {source.title}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {source.domain}
          </p>
        </div>
        <ExternalLink
          className="w-4 h-4 text-gray-400 group-hover:text-blue-500
                     transition-colors flex-shrink-0"
        />
      </div>

      {source.supported_claims.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
          <p className="text-xs text-gray-500">
            Supports {source.supported_claims.length} claim(s)
          </p>
        </div>
      )}
    </a>
  );
}
```

### 2.7 Citation Message Renderer

**File: `frontend/src/components/citation-message.tsx`**

```tsx
"use client";

import { useCoagentState } from "@copilotkit/react-core";
import { Source } from "@/lib/types";
import ReactMarkdown from "react-markdown";
import { useMemo } from "react";

interface CitationMessageProps {
  content: string;
}

export function CitationMessage({ content }: CitationMessageProps) {
  const { state } = useCoagentState<{ sources: Record<string, Source> }>();
  const sources = state?.sources || {};

  // Replace citation tags with clickable links
  const processedContent = useMemo(() => {
    // Match patterns like [src-1], [src-2], etc.
    return content.replace(/\[src-(\d+)\]/g, (match, num) => {
      const shortId = `src-${num}`;
      const source = sources[shortId];
      if (source) {
        return `[${shortId}](${source.url} "${source.title}")`;
      }
      return match;
    });
  }, [content, sources]);

  return (
    <div className="prose dark:prose-invert max-w-none">
      <ReactMarkdown
        components={{
          a: ({ href, title, children }) => {
            // Check if this is a citation link
            const isCitation = String(children).startsWith("src-");

            if (isCitation) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={title}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-xs
                             bg-blue-100 dark:bg-blue-900/30 text-blue-700
                             dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/50
                             no-underline transition-colors"
                >
                  {children}
                </a>
              );
            }

            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
```

---

## Phase 3: State Synchronization

### 3.1 AG-UI State Events Flow

```
Backend (ADK Agent)                    AG-UI Protocol                    Frontend (CopilotKit)
═══════════════════════════════════════════════════════════════════════════════════════════════

callback_context.state["phase"]   -->  STATE_DELTA event         -->  useCoagentState hook
                                       {
                                         op: "replace",
                                         path: "/phase",
                                         value: "researching"
                                       }

callback_context.state["sources"] -->  STATE_DELTA event         -->  useCoagentState hook
                                       {
                                         op: "add",
                                         path: "/sources/src-5",
                                         value: { url: "...", ... }
                                       }
```

### 3.2 Custom State Hook

**File: `frontend/src/hooks/use-research-state.ts`**

```typescript
import { useCoagentState } from "@copilotkit/react-core";
import { ResearchState } from "@/lib/types";

export function useResearchState() {
  const { state, setState } = useCoagentState<ResearchState>();

  return {
    // Current phase
    phase: state?.phase || "planning",

    // Research plan
    plan: state?.research_plan,
    isPlanApproved: state?.research_plan?.approved || false,

    // Progress tracking
    currentIteration: state?.current_iteration || 0,
    maxIterations: state?.max_iterations || 3,

    // Sources
    sources: state?.sources || {},
    sourceCount: Object.keys(state?.sources || {}).length,

    // Report
    sections: state?.report_sections || [],
    finalReport: state?.final_report,

    // Evaluation
    evaluation: state?.research_evaluation,

    // Helpers
    isResearching: ["researching", "evaluating", "refining"].includes(state?.phase || ""),
    isComplete: state?.phase === "complete",
  };
}
```

---

## Phase 4: Configuration

### 4.1 Environment Variables

**File: `.env.example`**

```bash
# Backend
GOOGLE_API_KEY=your_gemini_api_key
GOOGLE_SEARCH_API_KEY=your_search_api_key  # Optional: for custom search
GOOGLE_SEARCH_ENGINE_ID=your_engine_id     # Optional: for custom search

# Research Configuration
DEFAULT_MODEL=gemini-2.0-flash
MAX_RESEARCH_ITERATIONS=3
MAX_SECTIONS=10

# Frontend
NEXT_PUBLIC_APP_URL=http://localhost:3000
RESEARCH_AGENT_URL=http://localhost:8000/research
```

### 4.2 Research Configuration

**File: `backend/src/config.py`**

```python
from pydantic_settings import BaseSettings
from typing import Literal

class ResearchConfig(BaseSettings):
    # Model configuration
    planner_model: str = "gemini-2.0-flash"
    researcher_model: str = "gemini-2.0-flash"
    evaluator_model: str = "gemini-2.0-flash"
    composer_model: str = "gemini-2.0-flash"

    # Research parameters
    max_iterations: int = 3
    max_sections: int = 10
    min_sources_per_section: int = 2

    # Quality thresholds
    passing_grade: Literal["A", "B", "C"] = "B"

    # API keys
    google_api_key: str
    google_search_api_key: str | None = None
    google_search_engine_id: str | None = None

    class Config:
        env_file = ".env"

config = ResearchConfig()
```

---

## Phase 5: Development Workflow

### 5.1 Docker Compose for Local Development

**File: `docker-compose.yml`**

```yaml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
    volumes:
      - ./backend/src:/app/src
    command: uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - RESEARCH_AGENT_URL=http://backend:8000/research
    volumes:
      - ./frontend/src:/app/src
    depends_on:
      - backend
    command: npm run dev
```

### 5.2 Backend Dockerfile

**File: `backend/Dockerfile`**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY pyproject.toml requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY src/ ./src/

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 5.3 Frontend Dockerfile

**File: `frontend/Dockerfile`**

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
```

---

## Implementation Order

### Week 1: Foundation
1. [ ] Set up monorepo structure with backend/frontend
2. [ ] Configure FastAPI with AG-UI ADK middleware
3. [ ] Create basic CopilotKit frontend with chat
4. [ ] Implement simple echo agent to verify connectivity

### Week 2: Agent Architecture
5. [ ] Implement root `interactive_planner_agent`
6. [ ] Add plan generation with HITL approval
7. [ ] Create `PlanApproval` component
8. [ ] Test full plan approval flow

### Week 3: Research Pipeline
9. [ ] Implement `section_planner` agent
10. [ ] Implement `section_researcher` with google_search
11. [ ] Add source collection callback
12. [ ] Create `SourceSidebar` component

### Week 4: Refinement Loop
13. [ ] Implement `research_evaluator` agent
14. [ ] Create `EscalationChecker` custom agent
15. [ ] Implement `enhanced_search_executor`
16. [ ] Add `ResearchTimeline` component

### Week 5: Report Generation
17. [ ] Implement `report_composer` agent
18. [ ] Add citation replacement callback
19. [ ] Create `CitationMessage` component
20. [ ] Implement final report display

### Week 6: Polish
21. [ ] Add effort level configuration
22. [ ] Implement error handling and retry logic
23. [ ] Add loading states and animations
24. [ ] Write tests and documentation

---

## Key Differences from Original

| Aspect | Original Deep-Search | This Implementation |
|--------|---------------------|---------------------|
| Frontend | Custom React + Vite | Next.js + CopilotKit |
| Backend | ADK + FastAPI | ADK + AG-UI Middleware + FastAPI |
| Streaming | Custom SSE handling | AG-UI protocol events |
| HITL | Custom implementation | `useHumanInTheLoop` hook |
| State sync | Manual state polling | AG-UI `STATE_DELTA` events |
| Session mgmt | Custom session API | AG-UI thread_id |

---

## Testing Strategy

### Unit Tests
- Agent instruction validation
- State model serialization
- Citation replacement logic
- Source extraction from grounding metadata

### Integration Tests
- Full research flow with mocked LLM responses
- HITL approval/rejection flows
- State synchronization between frontend/backend
- Error recovery scenarios

### E2E Tests (Playwright)
- Complete research journey
- Plan modification and approval
- Source sidebar population
- Citation link functionality

---

## Open Questions for Discussion

1. **Effort levels**: Should we expose Gemini model selection (flash vs pro) or abstract it?

2. **Persistence**: Do we need to persist research sessions across page reloads? If so, should we use:
   - Browser localStorage
   - Backend database
   - AG-UI's built-in thread persistence

3. **Export formats**: Should the final report support export to:
   - Markdown
   - PDF
   - Google Docs

4. **Concurrent research**: Should users be able to run multiple research sessions?

5. **Source verification**: Should we add a UI to let users verify/reject individual sources?

---

## Next Steps

Once you've reviewed this plan, let me know:
1. Which aspects you'd like to modify or expand
2. Any features to add or remove
3. Priority order if different from above
4. Answers to the open questions

Then you can pull this down locally and we can start implementation!
