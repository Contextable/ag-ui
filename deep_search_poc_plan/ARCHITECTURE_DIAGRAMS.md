# Deep Search POC - Architecture Diagrams

## 1. User Journey Flow with 5 HITL Checkpoints

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend (CopilotKit)
    participant B as Backend (ADK + AGUIToolset)
    participant G as Gemini API
    participant S as Google Search

    U->>F: Enter research topic
    F->>B: Send message via AG-UI (with 5 HITL tools)
    B->>G: Generate research plan
    G-->>B: Plan with objectives

    rect rgb(200, 230, 201)
        Note over F,B: HITL #1: Plan Approval (Root Agent)
        B->>F: TOOL_CALL (approve_research_plan)
        Note over F: PlanApproval UI appears
        U->>F: Modify objectives, approve
        F->>B: TOOL_RESULT (approved: true, plan)
    end

    B->>G: Generate report outline

    rect rgb(200, 230, 201)
        Note over F,B: HITL #2: Outline Review (section_planner)
        B->>F: TOOL_CALL (review_outline)
        Note over F: OutlineReview UI appears
        U->>F: Reorder sections, approve
        F->>B: TOOL_RESULT (approved: true, outline)
    end

    B->>S: Execute searches
    S-->>B: Search results
    B->>F: STATE_DELTA (sources updated)

    rect rgb(200, 230, 201)
        Note over F,B: HITL #3: Source Verification (section_researcher)
        B->>F: TOOL_CALL (verify_sources)
        Note over F: SourceVerification UI appears
        U->>F: Accept/reject sources
        F->>B: TOOL_RESULT (accepted_sources, guidance)
    end

    loop Refinement (max 3 iterations)
        B->>G: Evaluate research quality
        alt Grade < B
            rect rgb(200, 230, 201)
                Note over F,B: HITL #4: Refinement Guidance (research_evaluator)
                B->>F: TOOL_CALL (guide_refinement)
                Note over F: RefinementGuidance UI appears
                U->>F: Select queries, add guidance
                F->>B: TOOL_RESULT (continue: true, queries)
            end
            B->>S: Additional searches
            S-->>B: More results
        else Grade >= B
            Note over B: Escalate to composition
        end
    end

    B->>G: Compose final report
    G-->>B: Report with citations

    rect rgb(200, 230, 201)
        Note over F,B: HITL #5: Draft Review (report_composer)
        B->>F: TOOL_CALL (review_draft)
        Note over F: DraftReview UI appears
        U->>F: Review, approve
        F->>B: TOOL_RESULT (approved: true)
    end

    B->>F: TEXT_MESSAGE (final report)
    B->>F: STATE_DELTA (phase: complete)
```

## 2. Agent Hierarchy with AGUIToolset (PR #904)

```mermaid
graph TB
    subgraph Root["interactive_planner_agent"]
        direction TB
        P[Plan Generation]
        HITL1["HITL #1: approve_research_plan"]
        TS1["AGUIToolset(filter=['approve_research_plan'])"]
    end

    subgraph Pipeline["research_pipeline (Sequential)"]
        direction TB

        subgraph SP["section_planner"]
            HITL2["HITL #2: review_outline"]
            TS2["AGUIToolset(filter=['review_outline'])"]
        end

        subgraph SR["section_researcher"]
            HITL3["HITL #3: verify_sources"]
            TS3["AGUIToolset(filter=['verify_sources'])"]
        end

        subgraph Loop["iterative_refinement_loop"]
            direction TB
            subgraph RE["research_evaluator"]
                HITL4["HITL #4: guide_refinement"]
                TS4["AGUIToolset(filter=['guide_refinement'])"]
            end
            EC[escalation_checker]
            ES[enhanced_search_executor]
        end

        subgraph RC["report_composer"]
            HITL5["HITL #5: review_draft"]
            TS5["AGUIToolset(filter=['review_draft'])"]
        end
    end

    Root --> Pipeline
    SP --> SR
    SR --> Loop
    RE --> EC
    EC -->|not pass| ES
    ES --> RE
    EC -->|pass| RC
    Loop --> RC

    style Root fill:#e1f5fe
    style Pipeline fill:#f3e5f5
    style Loop fill:#fff3e0
    style HITL1 fill:#c8e6c9
    style HITL2 fill:#c8e6c9
    style HITL3 fill:#c8e6c9
    style HITL4 fill:#c8e6c9
    style HITL5 fill:#c8e6c9
```

## 3. State Flow

```mermaid
flowchart LR
    subgraph Backend
        direction TB
        CS[callback_context.state]
        SC[Source Callback]
        CC[Citation Callback]
    end

    subgraph "AG-UI Protocol"
        direction TB
        SS[STATE_SNAPSHOT]
        SD[STATE_DELTA]
    end

    subgraph Frontend
        direction TB
        UCS[useCoagentState]
        TL[Timeline]
        SB[Sidebar]
        CM[CitationMessage]
    end

    CS -->|emit| SD
    SC -->|update| CS
    CC -->|update| CS
    SS --> UCS
    SD --> UCS
    UCS --> TL
    UCS --> SB
    UCS --> CM
```

## 4. Human-in-the-Loop Flow

```mermaid
stateDiagram-v2
    [*] --> Planning: User submits topic

    Planning --> AwaitingApproval: Plan generated

    state AwaitingApproval {
        [*] --> ShowingPlan
        ShowingPlan --> EditingPlan: User modifies
        EditingPlan --> ShowingPlan: User saves
        ShowingPlan --> [*]: User decides
    }

    AwaitingApproval --> Planning: Rejected with feedback
    AwaitingApproval --> Researching: Approved

    Researching --> Evaluating: Initial research done

    state RefinementLoop {
        Evaluating --> Refining: Grade < B
        Refining --> Evaluating: Search complete
        Evaluating --> [*]: Grade >= B OR max iterations
    }

    Evaluating --> RefinementLoop

    RefinementLoop --> Composing: Refinement complete

    Composing --> Complete: Report generated

    Complete --> [*]
```

## 5. Component Architecture with All HITL Components

```mermaid
graph TB
    subgraph Page["page.tsx"]
        CK[CopilotKit Provider]
    end

    subgraph Layout
        TL[ResearchTimeline]
        Chat[ResearchChat]
        SS[SourceSidebar]
    end

    subgraph "HITL Components (rendered by useHumanInTheLoop)"
        PA["PlanApproval (HITL #1)"]
        OR["OutlineReview (HITL #2)"]
        SV["SourceVerification (HITL #3)"]
        RG["RefinementGuidance (HITL #4)"]
        DR["DraftReview (HITL #5)"]
    end

    subgraph "Chat Components"
        CC[CopilotChat]
        CM[CitationMessage]
    end

    subgraph "Hooks (5 useHumanInTheLoop calls)"
        UHITL1["useHumanInTheLoop('approve_research_plan')"]
        UHITL2["useHumanInTheLoop('review_outline')"]
        UHITL3["useHumanInTheLoop('verify_sources')"]
        UHITL4["useHumanInTheLoop('guide_refinement')"]
        UHITL5["useHumanInTheLoop('review_draft')"]
        UCS[useCoagentState]
    end

    CK --> Layout
    Layout --> TL
    Layout --> Chat
    Layout --> SS

    Chat --> CC
    Chat --> CM

    UHITL1 --> PA
    UHITL2 --> OR
    UHITL3 --> SV
    UHITL4 --> RG
    UHITL5 --> DR

    TL --> UCS
    SS --> UCS
    CM --> UCS

    style PA fill:#c8e6c9
    style OR fill:#c8e6c9
    style SV fill:#c8e6c9
    style RG fill:#c8e6c9
    style DR fill:#c8e6c9
```

## 6. Event Timeline

```mermaid
gantt
    title Research Session Event Timeline
    dateFormat X
    axisFormat %s

    section Lifecycle
    RUN_STARTED           :0, 1
    RUN_FINISHED          :98, 100

    section Planning
    TEXT_MESSAGE (plan)    :1, 10
    TOOL_CALL (approve)    :10, 15
    TOOL_RESULT (approved) :15, 16

    section Research
    STATE_DELTA (phase)    :16, 17
    TOOL_CALL (search)     :17, 25
    STATE_DELTA (sources)  :25, 26
    TEXT_MESSAGE (findings):26, 35

    section Evaluation
    STATE_DELTA (phase)    :35, 36
    TEXT_MESSAGE (eval)    :36, 45

    section Refinement
    TOOL_CALL (search)     :45, 55
    STATE_DELTA (sources)  :55, 56

    section Composition
    STATE_DELTA (phase)    :56, 57
    TEXT_MESSAGE (report)  :57, 95
    STATE_DELTA (complete) :95, 98
```

## 7. Data Models

```mermaid
erDiagram
    ResearchState ||--o| ResearchPlan : has
    ResearchState ||--o{ ReportSection : contains
    ResearchState ||--o{ Source : tracks
    ResearchState ||--o| ResearchEvaluation : has

    ResearchPlan ||--o{ ResearchObjective : contains

    ResearchObjective {
        string description
        ObjectiveTag tag
        ObjectiveStatus status
    }

    Source {
        string url
        string title
        string domain
        string short_id
        float confidence
    }

    ReportSection {
        string title
        string content
        string[] source_ids
    }

    ResearchEvaluation {
        EvaluationGrade grade
        string feedback
        string[] gaps
        boolean pass
    }
```

## 8. AGUIToolset Mechanism (PR #904)

This diagram shows how AGUIToolset enables HITL tools to be available to sub-agents.

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant RT as CopilotKit Runtime
    participant MW as ADK Middleware
    participant RA as Root Agent
    participant SA as Sub-Agent

    Note over FE: Register 5 useHumanInTheLoop hooks

    FE->>RT: Register tools via hooks
    RT->>MW: RunAgentInput.tools = [5 HITL tools]

    Note over MW: AGUIToolset created for each agent

    MW->>RA: Inject AGUIToolset(filter=['approve_research_plan'])
    MW->>SA: Inject AGUIToolset(filter=['review_outline', 'verify_sources', ...])

    Note over RA,SA: Each agent only sees filtered tools

    RA->>MW: Call approve_research_plan
    MW->>RT: TOOL_CALL event
    RT->>FE: Render PlanApproval
    FE->>RT: TOOL_RESULT
    RT->>MW: Continue execution
    MW->>RA: Tool result

    Note over RA: Delegates to sub-agent

    SA->>MW: Call review_outline (sub-agent!)
    MW->>RT: TOOL_CALL event
    RT->>FE: Render OutlineReview
    FE->>RT: TOOL_RESULT
    RT->>MW: Continue execution
    MW->>SA: Tool result
```

**Key Insight**: Without PR #904, only the root agent could access frontend tools. With `AGUIToolset`, each agent explicitly declares which tools it needs via `tool_filter`, enabling HITL at any level of the hierarchy.

## 9. Deployment Architecture

```mermaid
graph TB
    subgraph "User Browser"
        UI[Next.js Frontend]
    end

    subgraph "Vercel / Cloud Run"
        FE[Frontend Container]
        API[/api/copilotkit]
    end

    subgraph "Cloud Run / GKE"
        BE[FastAPI Backend]
        ADK[ADK Middleware]
    end

    subgraph "Google Cloud"
        GEM[Gemini API]
        GSE[Google Search]
    end

    UI --> FE
    FE --> API
    API -->|AG-UI SSE| BE
    BE --> ADK
    ADK --> GEM
    ADK --> GSE
```
