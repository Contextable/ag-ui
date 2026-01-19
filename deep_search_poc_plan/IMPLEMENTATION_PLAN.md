# Deep Search POC - CopilotKit Implementation Plan

## Overview

This document outlines the implementation plan for recreating Google's ADK deep-search sample using AG-UI protocol and CopilotKit as the frontend framework.

**Key Enhancement**: This implementation leverages `AGUIToolset` from [PR #904](https://github.com/ag-ui-protocol/ag-ui/pull/904) to enable **Human-in-the-Loop (HITL) at multiple points** throughout the agent hierarchy, not just at the root agent. This creates a more interactive research experience where users can approve plans, verify sources, guide refinement, and review drafts.

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
│       │   ├── research-chat.tsx      # Main chat wrapper with all HITL hooks
│       │   ├── plan-approval.tsx      # HITL: Plan approval (root agent)
│       │   ├── outline-review.tsx     # HITL: Outline review (section_planner)
│       │   ├── source-verification.tsx # HITL: Source verification (section_researcher)
│       │   ├── refinement-guidance.tsx # HITL: Refinement guidance (research_evaluator)
│       │   ├── draft-review.tsx       # HITL: Draft review (report_composer)
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

### 1.2 Agent Hierarchy Design with AGUIToolset

The agent hierarchy mirrors the original deep-search structure, **enhanced with AGUIToolset for HITL at each stage**:

```
interactive_planner_agent (LlmAgent) - ROOT
│   tools: [AGUIToolset(filter=['approve_research_plan']), google_search]
│   HITL: ✅ Plan approval - user reviews/modifies research objectives
│
└── research_pipeline (SequentialAgent)
    │
    ├── section_planner (LlmAgent)
    │   tools: [AGUIToolset(filter=['review_outline'])]
    │   HITL: ✅ Outline review - user approves report structure
    │
    ├── section_researcher (LlmAgent)
    │   tools: [AGUIToolset(filter=['verify_sources']), google_search]
    │   HITL: ✅ Source verification - user accepts/rejects sources
    │
    ├── iterative_refinement_loop (LoopAgent, max_iterations=3)
    │   ├── research_evaluator (LlmAgent)
    │   │   tools: [AGUIToolset(filter=['guide_refinement'])]
    │   │   HITL: ✅ Refinement guidance - user directs follow-up research
    │   ├── escalation_checker (custom BaseAgent)
    │   │   └── Triggers escalation on "pass" grade
    │   └── enhanced_search_executor (LlmAgent)
    │       tools: [google_search]
    │       └── Executes follow-up searches (no HITL needed)
    │
    └── report_composer (LlmAgent)
        tools: [AGUIToolset(filter=['review_draft'])]
        HITL: ✅ Draft review - user reviews final report before completion
```

### 1.3 AGUIToolset Integration

**Key Concept**: `AGUIToolset` (from PR #904) allows explicit injection of frontend tools into specific agents. Each agent only sees the tools relevant to its role.

**File: `backend/src/agents/root_agent.py`**

```python
from google.adk.agents import LlmAgent, SequentialAgent, LoopAgent
from google.adk.tools import google_search
from ag_ui_adk import AGUIToolset  # From PR #904

from .section_planner import create_section_planner
from .section_researcher import create_section_researcher
from .research_evaluator import create_research_evaluator
from .escalation_checker import EscalationChecker
from .enhanced_search import create_enhanced_search_executor
from .report_composer import create_report_composer
from ..callbacks.sources import collect_research_sources_callback
from ..callbacks.citations import citation_replacement_callback

def create_root_agent():
    """Create the complete deep search agent hierarchy with HITL at each stage."""

    # === HITL Toolsets for each agent ===
    # Each AGUIToolset filters which frontend tools the agent can access

    plan_approval_toolset = AGUIToolset(tool_filter=['approve_research_plan'])
    outline_review_toolset = AGUIToolset(tool_filter=['review_outline'])
    source_verification_toolset = AGUIToolset(tool_filter=['verify_sources'])
    refinement_guidance_toolset = AGUIToolset(tool_filter=['guide_refinement'])
    draft_review_toolset = AGUIToolset(tool_filter=['review_draft'])

    # === Build agent hierarchy bottom-up ===

    # Enhanced search executor (no HITL - autonomous refinement searches)
    enhanced_search_executor = LlmAgent(
        name="enhanced_search_executor",
        model="gemini-2.0-flash",
        instruction=ENHANCED_SEARCH_INSTRUCTION,
        tools=[google_search],
    )

    # Research evaluator with HITL for refinement guidance
    research_evaluator = LlmAgent(
        name="research_evaluator",
        model="gemini-2.0-flash",
        instruction=EVALUATOR_INSTRUCTION,
        tools=[refinement_guidance_toolset],  # HITL: guide_refinement
    )

    # Iterative refinement loop
    refinement_loop = LoopAgent(
        name="iterative_refinement_loop",
        max_iterations=3,
        sub_agents=[
            research_evaluator,
            EscalationChecker(name="escalation_checker"),
            enhanced_search_executor,
        ]
    )

    # Report composer with HITL for draft review
    report_composer = LlmAgent(
        name="report_composer",
        model="gemini-2.0-flash",
        instruction=COMPOSER_INSTRUCTION,
        tools=[draft_review_toolset],  # HITL: review_draft
    )

    # Section researcher with HITL for source verification
    section_researcher = LlmAgent(
        name="section_researcher",
        model="gemini-2.0-flash",
        instruction=RESEARCHER_INSTRUCTION,
        tools=[source_verification_toolset, google_search],  # HITL: verify_sources
    )

    # Section planner with HITL for outline review
    section_planner = LlmAgent(
        name="section_planner",
        model="gemini-2.0-flash",
        instruction=PLANNER_SECTION_INSTRUCTION,
        tools=[outline_review_toolset],  # HITL: review_outline
    )

    # Research pipeline (sequential execution)
    research_pipeline = SequentialAgent(
        name="research_pipeline",
        sub_agents=[
            section_planner,
            section_researcher,
            refinement_loop,
            report_composer,
        ]
    )

    # Root agent with HITL for plan approval
    root_agent = LlmAgent(
        name="interactive_planner_agent",
        model="gemini-2.0-flash",
        instruction=PLANNER_INSTRUCTION,
        tools=[plan_approval_toolset, google_search],  # HITL: approve_research_plan
        sub_agents=[research_pipeline],
        before_agent_callback=collect_research_sources_callback,
        after_agent_callback=citation_replacement_callback,
    )

    return root_agent


# === Agent Instructions ===

PLANNER_INSTRUCTION = """
You are a research planning assistant. Your role is to:

1. Understand the user's research topic
2. Generate a comprehensive research plan with tagged objectives:
   - [RESEARCH] - Primary research tasks
   - [DELIVERABLE] - Expected outputs
   - [MODIFIED] - User-modified objectives
   - [NEW] - Newly added objectives
   - [IMPLIED] - Inferred supporting tasks

3. ALWAYS call the `approve_research_plan` tool to present the plan for user approval
4. Incorporate user feedback if they request changes
5. Once approved, delegate to research_pipeline for execution

IMPORTANT: Never proceed with research without explicit user approval via the tool.
"""

PLANNER_SECTION_INSTRUCTION = """
You are a report structure planner. Based on the approved research plan:

1. Design a logical report outline with sections and subsections
2. ALWAYS call the `review_outline` tool to present the outline for user review
3. Incorporate any structural changes the user requests
4. Once approved, pass the outline to the section researcher
"""

RESEARCHER_INSTRUCTION = """
You are a research executor. For each section in the outline:

1. Execute web searches using google_search to gather information
2. Collect relevant sources with their URLs and key findings
3. After gathering initial sources, call `verify_sources` to let the user:
   - Accept or reject individual sources
   - Add guidance for additional sources needed
4. Synthesize findings into section content
"""

EVALUATOR_INSTRUCTION = """
You are a research quality evaluator. Your role is to:

1. Assess the quality and completeness of research findings
2. Identify gaps, missing perspectives, or areas needing more depth
3. Assign a grade (A/B/C/D/F) based on:
   - Source diversity and credibility
   - Coverage of the topic
   - Depth of analysis
4. If grade < B, call `guide_refinement` to get user input on:
   - Which areas to focus on
   - Specific questions to answer
   - Whether to continue or accept current quality
5. If grade >= B, recommend proceeding to report composition
"""

ENHANCED_SEARCH_INSTRUCTION = """
You are a targeted search executor. Based on evaluation feedback:

1. Execute focused searches to fill identified gaps
2. Prioritize the specific areas flagged by the evaluator
3. Return improved findings for re-evaluation
"""

COMPOSER_INSTRUCTION = """
You are a report composer. Your role is to:

1. Synthesize all research findings into a coherent report
2. Add inline citations using [src-N] format
3. Ensure logical flow between sections
4. ALWAYS call `review_draft` to present the draft for user review
5. Incorporate any final edits the user requests
6. Return the final cited report
"""
```

### 1.4 State Models

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

### 1.5 Source Collection Callback

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

### 2.3 Research Chat with All HITL Hooks

**File: `frontend/src/components/research-chat.tsx`**

This component registers **all five HITL hooks** that correspond to the AGUIToolset filters on the backend agents.

```tsx
"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import { useHumanInTheLoop } from "@copilotkit/react-core";
import { PlanApproval } from "./plan-approval";
import { OutlineReview } from "./outline-review";
import { SourceVerification } from "./source-verification";
import { RefinementGuidance } from "./refinement-guidance";
import { DraftReview } from "./draft-review";
import { CitationMessage } from "./citation-message";
import "@copilotkit/react-ui/styles.css";

export function ResearchChat() {
  // ==========================================================================
  // HITL #1: Plan Approval (Root Agent: interactive_planner_agent)
  // ==========================================================================
  useHumanInTheLoop({
    name: "approve_research_plan",
    description: "Present research plan for user approval before starting research",
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

  // ==========================================================================
  // HITL #2: Outline Review (Sub-Agent: section_planner)
  // ==========================================================================
  useHumanInTheLoop({
    name: "review_outline",
    description: "Present report outline for user review and approval",
    parameters: [
      {
        name: "outline",
        type: "object",
        attributes: [
          { name: "title", type: "string" },
          {
            name: "sections",
            type: "object[]",
            attributes: [
              { name: "title", type: "string" },
              { name: "description", type: "string" },
              { name: "subsections", type: "string[]" },
            ],
          },
        ],
      },
    ],
    render: ({ args, respond, status }) => (
      <OutlineReview
        outline={args.outline}
        status={status}
        onApprove={(modifiedOutline) => respond({ approved: true, outline: modifiedOutline })}
        onReject={(feedback) => respond({ approved: false, feedback })}
      />
    ),
  });

  // ==========================================================================
  // HITL #3: Source Verification (Sub-Agent: section_researcher)
  // ==========================================================================
  useHumanInTheLoop({
    name: "verify_sources",
    description: "Present discovered sources for user verification",
    parameters: [
      {
        name: "sources",
        type: "object[]",
        attributes: [
          { name: "url", type: "string" },
          { name: "title", type: "string" },
          { name: "domain", type: "string" },
          { name: "snippet", type: "string" },
          { name: "relevance_score", type: "number" },
        ],
      },
      { name: "section_title", type: "string" },
    ],
    render: ({ args, respond, status }) => (
      <SourceVerification
        sources={args.sources}
        sectionTitle={args.section_title}
        status={status}
        onConfirm={(acceptedSources, guidance) =>
          respond({ accepted_sources: acceptedSources, additional_guidance: guidance })
        }
      />
    ),
  });

  // ==========================================================================
  // HITL #4: Refinement Guidance (Sub-Agent: research_evaluator)
  // ==========================================================================
  useHumanInTheLoop({
    name: "guide_refinement",
    description: "Get user guidance for research refinement when quality is below threshold",
    parameters: [
      { name: "current_grade", type: "string" },
      { name: "gaps_identified", type: "string[]" },
      { name: "suggested_queries", type: "string[]" },
      { name: "iteration", type: "number" },
      { name: "max_iterations", type: "number" },
    ],
    render: ({ args, respond, status }) => (
      <RefinementGuidance
        grade={args.current_grade}
        gaps={args.gaps_identified}
        suggestedQueries={args.suggested_queries}
        iteration={args.iteration}
        maxIterations={args.max_iterations}
        status={status}
        onContinue={(selectedQueries, customGuidance) =>
          respond({ continue_refinement: true, queries: selectedQueries, guidance: customGuidance })
        }
        onAcceptAsIs={() => respond({ continue_refinement: false, accept_current: true })}
      />
    ),
  });

  // ==========================================================================
  // HITL #5: Draft Review (Sub-Agent: report_composer)
  // ==========================================================================
  useHumanInTheLoop({
    name: "review_draft",
    description: "Present final draft for user review before completion",
    parameters: [
      { name: "draft_content", type: "string" },
      { name: "word_count", type: "number" },
      { name: "source_count", type: "number" },
      {
        name: "sections",
        type: "object[]",
        attributes: [
          { name: "title", type: "string" },
          { name: "preview", type: "string" },
        ],
      },
    ],
    render: ({ args, respond, status }) => (
      <DraftReview
        content={args.draft_content}
        wordCount={args.word_count}
        sourceCount={args.source_count}
        sections={args.sections}
        status={status}
        onApprove={() => respond({ approved: true })}
        onRequestChanges={(feedback) => respond({ approved: false, feedback })}
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

### 2.5 Outline Review Component (HITL #2)

**File: `frontend/src/components/outline-review.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ReportOutline, OutlineSection } from "@/lib/types";
import { ChevronDown, ChevronRight, Plus, Trash2, GripVertical } from "lucide-react";

interface OutlineReviewProps {
  outline: ReportOutline;
  status: "executing" | "complete" | "inProgress";
  onApprove: (outline: ReportOutline) => void;
  onReject: (feedback: string) => void;
}

export function OutlineReview({ outline, status, onApprove, onReject }: OutlineReviewProps) {
  const [localOutline, setLocalOutline] = useState<ReportOutline>(outline);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]));
  const [feedback, setFeedback] = useState("");

  const toggleSection = (index: number) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSections(newExpanded);
  };

  const addSection = () => {
    const title = prompt("Enter section title:");
    if (title) {
      setLocalOutline((prev) => ({
        ...prev,
        sections: [...prev.sections, { title, description: "", subsections: [] }],
      }));
    }
  };

  const removeSection = (index: number) => {
    setLocalOutline((prev) => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== index),
    }));
  };

  const isDisabled = status !== "executing";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 max-w-2xl">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          Report Outline
        </h2>
        <p className="text-gray-600 dark:text-gray-300 mt-1">
          {localOutline.title}
        </p>
      </div>

      {/* Sections List */}
      <div className="space-y-2 mb-6">
        {localOutline.sections.map((section, index) => (
          <div key={index} className="border border-gray-200 dark:border-gray-700 rounded-lg">
            <div
              className="flex items-center gap-2 p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={() => toggleSection(index)}
            >
              {expandedSections.has(index) ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              <span className="flex-1 font-medium">{section.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeSection(index);
                }}
                disabled={isDisabled}
                className="p-1 text-red-500 hover:bg-red-50 rounded disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {expandedSections.has(index) && section.subsections.length > 0 && (
              <div className="px-6 pb-3 space-y-1">
                {section.subsections.map((sub, subIndex) => (
                  <p key={subIndex} className="text-sm text-gray-600 dark:text-gray-400">
                    • {sub}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Section Button */}
      <button
        onClick={addSection}
        disabled={isDisabled}
        className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg
                   text-gray-500 hover:border-blue-400 hover:text-blue-500
                   disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" /> Add Section
      </button>

      {/* Action Buttons */}
      <div className="flex gap-3 mt-6">
        <button
          onClick={() => onReject(feedback || "Please restructure the outline")}
          disabled={isDisabled}
          className="flex-1 py-3 px-4 bg-gray-200 dark:bg-gray-700 rounded-lg font-medium
                     disabled:opacity-50 transition-colors"
        >
          Request Changes
        </button>
        <button
          onClick={() => onApprove(localOutline)}
          disabled={isDisabled}
          className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium
                     hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          Approve Outline
        </button>
      </div>
    </div>
  );
}
```

### 2.6 Source Verification Component (HITL #3)

**File: `frontend/src/components/source-verification.tsx`**

```tsx
"use client";

import { useState } from "react";
import { DiscoveredSource } from "@/lib/types";
import { Check, X, ExternalLink, AlertCircle } from "lucide-react";

interface SourceVerificationProps {
  sources: DiscoveredSource[];
  sectionTitle: string;
  status: "executing" | "complete" | "inProgress";
  onConfirm: (acceptedSources: string[], guidance?: string) => void;
}

export function SourceVerification({
  sources,
  sectionTitle,
  status,
  onConfirm,
}: SourceVerificationProps) {
  const [sourceStates, setSourceStates] = useState<Record<string, "accepted" | "rejected" | "pending">>(
    Object.fromEntries(sources.map((s) => [s.url, "pending"]))
  );
  const [additionalGuidance, setAdditionalGuidance] = useState("");

  const toggleSource = (url: string) => {
    setSourceStates((prev) => ({
      ...prev,
      [url]: prev[url] === "accepted" ? "rejected" : "accepted",
    }));
  };

  const acceptAll = () => {
    setSourceStates(Object.fromEntries(sources.map((s) => [s.url, "accepted"])));
  };

  const handleConfirm = () => {
    const acceptedUrls = Object.entries(sourceStates)
      .filter(([_, state]) => state === "accepted")
      .map(([url]) => url);
    onConfirm(acceptedUrls, additionalGuidance || undefined);
  };

  const isDisabled = status !== "executing";
  const acceptedCount = Object.values(sourceStates).filter((s) => s === "accepted").length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 max-w-3xl">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          Verify Sources
        </h2>
        <p className="text-gray-600 dark:text-gray-300 mt-1">
          Section: <span className="font-medium">{sectionTitle}</span>
        </p>
        <p className="text-sm text-gray-500 mt-2">
          {acceptedCount} of {sources.length} sources accepted
        </p>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={acceptAll}
          disabled={isDisabled}
          className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded-full
                     hover:bg-green-200 disabled:opacity-50"
        >
          Accept All
        </button>
      </div>

      {/* Sources List */}
      <div className="space-y-3 mb-6 max-h-96 overflow-y-auto">
        {sources.map((source) => (
          <div
            key={source.url}
            className={`p-3 rounded-lg border transition-all ${
              sourceStates[source.url] === "accepted"
                ? "border-green-300 bg-green-50 dark:bg-green-900/20"
                : sourceStates[source.url] === "rejected"
                  ? "border-red-300 bg-red-50 dark:bg-red-900/20 opacity-60"
                  : "border-gray-200 dark:border-gray-700"
            }`}
          >
            <div className="flex items-start gap-3">
              <button
                onClick={() => toggleSource(source.url)}
                disabled={isDisabled}
                className={`mt-1 p-1 rounded-full transition-colors ${
                  sourceStates[source.url] === "accepted"
                    ? "bg-green-500 text-white"
                    : sourceStates[source.url] === "rejected"
                      ? "bg-red-500 text-white"
                      : "bg-gray-200 dark:bg-gray-700"
                }`}
              >
                {sourceStates[source.url] === "accepted" ? (
                  <Check className="w-4 h-4" />
                ) : sourceStates[source.url] === "rejected" ? (
                  <X className="w-4 h-4" />
                ) : (
                  <div className="w-4 h-4" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 dark:text-white truncate">
                    {source.title}
                  </p>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-blue-500"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
                <p className="text-xs text-gray-500">{source.domain}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                  {source.snippet}
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-500">
                  {Math.round(source.relevance_score * 100)}% relevant
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Additional Guidance */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Additional search guidance (optional)
        </label>
        <textarea
          value={additionalGuidance}
          onChange={(e) => setAdditionalGuidance(e.target.value)}
          disabled={isDisabled}
          placeholder="e.g., Look for more academic sources, avoid news articles..."
          className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          rows={2}
        />
      </div>

      {/* Confirm Button */}
      <button
        onClick={handleConfirm}
        disabled={isDisabled || acceptedCount === 0}
        className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium
                   hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        Confirm {acceptedCount} Source{acceptedCount !== 1 ? "s" : ""}
      </button>
    </div>
  );
}
```

### 2.7 Refinement Guidance Component (HITL #4)

**File: `frontend/src/components/refinement-guidance.tsx`**

```tsx
"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle, Search, XCircle } from "lucide-react";

interface RefinementGuidanceProps {
  grade: string;
  gaps: string[];
  suggestedQueries: string[];
  iteration: number;
  maxIterations: number;
  status: "executing" | "complete" | "inProgress";
  onContinue: (selectedQueries: string[], customGuidance?: string) => void;
  onAcceptAsIs: () => void;
}

export function RefinementGuidance({
  grade,
  gaps,
  suggestedQueries,
  iteration,
  maxIterations,
  status,
  onContinue,
  onAcceptAsIs,
}: RefinementGuidanceProps) {
  const [selectedQueries, setSelectedQueries] = useState<Set<string>>(
    new Set(suggestedQueries)
  );
  const [customGuidance, setCustomGuidance] = useState("");

  const toggleQuery = (query: string) => {
    const newSelected = new Set(selectedQueries);
    if (newSelected.has(query)) {
      newSelected.delete(query);
    } else {
      newSelected.add(query);
    }
    setSelectedQueries(newSelected);
  };

  const isDisabled = status !== "executing";
  const isLastIteration = iteration >= maxIterations;

  const gradeColors: Record<string, string> = {
    A: "text-green-600 bg-green-100",
    B: "text-blue-600 bg-blue-100",
    C: "text-yellow-600 bg-yellow-100",
    D: "text-orange-600 bg-orange-100",
    F: "text-red-600 bg-red-100",
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 max-w-2xl">
      {/* Header with Grade */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          Research Quality Review
        </h2>
        <div className={`px-3 py-1 rounded-full font-bold ${gradeColors[grade] || gradeColors.C}`}>
          Grade: {grade}
        </div>
      </div>

      {/* Iteration Progress */}
      <div className="mb-4 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
        <div className="flex items-center justify-between text-sm">
          <span>Refinement Iteration</span>
          <span className="font-medium">{iteration} / {maxIterations}</span>
        </div>
        <div className="mt-2 h-2 bg-gray-300 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${(iteration / maxIterations) * 100}%` }}
          />
        </div>
        {isLastIteration && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            This is the final refinement iteration
          </p>
        )}
      </div>

      {/* Identified Gaps */}
      <div className="mb-4">
        <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-2">
          Identified Gaps
        </h3>
        <ul className="space-y-1">
          {gaps.map((gap, index) => (
            <li key={index} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
              <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              {gap}
            </li>
          ))}
        </ul>
      </div>

      {/* Suggested Queries */}
      <div className="mb-4">
        <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-2">
          Suggested Follow-up Searches
        </h3>
        <div className="space-y-2">
          {suggestedQueries.map((query) => (
            <label
              key={query}
              className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all ${
                selectedQueries.has(query)
                  ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-300"
                  : "bg-gray-50 dark:bg-gray-700 border border-transparent"
              }`}
            >
              <input
                type="checkbox"
                checked={selectedQueries.has(query)}
                onChange={() => toggleQuery(query)}
                disabled={isDisabled}
                className="rounded text-blue-600"
              />
              <Search className="w-4 h-4 text-gray-400" />
              <span className="text-sm">{query}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Custom Guidance */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Additional guidance (optional)
        </label>
        <textarea
          value={customGuidance}
          onChange={(e) => setCustomGuidance(e.target.value)}
          disabled={isDisabled}
          placeholder="Provide specific direction for the research refinement..."
          className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          rows={2}
        />
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={onAcceptAsIs}
          disabled={isDisabled}
          className="flex-1 py-3 px-4 bg-gray-200 dark:bg-gray-700 rounded-lg font-medium
                     disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <CheckCircle className="w-4 h-4" />
          Accept Current Quality
        </button>
        <button
          onClick={() => onContinue(Array.from(selectedQueries), customGuidance || undefined)}
          disabled={isDisabled || selectedQueries.size === 0}
          className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium
                     hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          Continue Refinement ({selectedQueries.size} queries)
        </button>
      </div>
    </div>
  );
}
```

### 2.8 Draft Review Component (HITL #5)

**File: `frontend/src/components/draft-review.tsx`**

```tsx
"use client";

import { useState } from "react";
import { FileText, CheckCircle, Edit3, ChevronDown, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface DraftReviewProps {
  content: string;
  wordCount: number;
  sourceCount: number;
  sections: { title: string; preview: string }[];
  status: "executing" | "complete" | "inProgress";
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
}

export function DraftReview({
  content,
  wordCount,
  sourceCount,
  sections,
  status,
  onApprove,
  onRequestChanges,
}: DraftReviewProps) {
  const [showFullContent, setShowFullContent] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  const isDisabled = status !== "executing";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Draft Review
        </h2>
        <div className="flex gap-4 text-sm text-gray-500">
          <span>{wordCount.toLocaleString()} words</span>
          <span>{sourceCount} sources</span>
        </div>
      </div>

      {/* Section Overview */}
      <div className="mb-4">
        <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-2">
          Sections ({sections.length})
        </h3>
        <div className="grid gap-2">
          {sections.map((section, index) => (
            <div
              key={index}
              className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
            >
              <p className="font-medium text-sm">{section.title}</p>
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                {section.preview}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Full Content Toggle */}
      <div className="mb-4">
        <button
          onClick={() => setShowFullContent(!showFullContent)}
          className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
        >
          {showFullContent ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          {showFullContent ? "Hide" : "Show"} Full Draft
        </button>
        {showFullContent && (
          <div className="mt-3 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg max-h-96 overflow-y-auto">
            <div className="prose dark:prose-invert prose-sm max-w-none">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* Feedback Input */}
      {showFeedback && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            What changes would you like?
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            disabled={isDisabled}
            placeholder="Describe the changes needed..."
            className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            rows={3}
          />
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        {!showFeedback ? (
          <button
            onClick={() => setShowFeedback(true)}
            disabled={isDisabled}
            className="flex-1 py-3 px-4 bg-gray-200 dark:bg-gray-700 rounded-lg font-medium
                       disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            <Edit3 className="w-4 h-4" />
            Request Changes
          </button>
        ) : (
          <button
            onClick={() => onRequestChanges(feedback)}
            disabled={isDisabled || !feedback.trim()}
            className="flex-1 py-3 px-4 bg-amber-500 text-white rounded-lg font-medium
                       disabled:opacity-50 transition-colors"
          >
            Submit Feedback
          </button>
        )}
        <button
          onClick={onApprove}
          disabled={isDisabled}
          className="flex-1 py-3 px-4 bg-green-600 text-white rounded-lg font-medium
                     hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <CheckCircle className="w-4 h-4" />
          Approve & Finalize
        </button>
      </div>
    </div>
  );
}
```

### 2.9 Research Timeline Component

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
| HITL | Conversational (1 checkpoint) | `useHumanInTheLoop` + AGUIToolset (5 checkpoints) |
| HITL Scope | Root agent only | **All agents via AGUIToolset** (PR #904) |
| State sync | Manual state polling | AG-UI `STATE_DELTA` events |
| Session mgmt | Custom session API | AG-UI thread_id |

### Enhanced HITL Experience

This implementation significantly improves user control compared to the original:

| HITL Checkpoint | Original | This POC |
|-----------------|----------|----------|
| Plan approval | Conversational | Rich UI with objective editing |
| Outline review | None | Section reordering/editing |
| Source verification | None | Accept/reject individual sources |
| Refinement guidance | None | Query selection + custom guidance |
| Draft review | None | Full preview with change requests |

**Dependency**: This enhanced HITL relies on [PR #904](https://github.com/ag-ui-protocol/ag-ui/pull/904) which introduces `AGUIToolset` for explicit tool injection into sub-agents.

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
