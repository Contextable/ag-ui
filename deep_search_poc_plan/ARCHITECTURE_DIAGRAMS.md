# Deep Search POC - Architecture Diagrams

## 1. User Journey Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend (CopilotKit)
    participant B as Backend (ADK)
    participant G as Gemini API
    participant S as Google Search

    U->>F: Enter research topic
    F->>B: Send message via AG-UI
    B->>G: Generate research plan
    G-->>B: Plan with objectives
    B->>F: STATE_DELTA (phase: awaiting_approval)
    B->>F: TOOL_CALL (approve_research_plan)

    Note over F: Plan Approval UI appears

    U->>F: Modify and approve plan
    F->>B: TOOL_RESULT (approved: true, plan)

    loop For each section
        B->>G: Generate section outline
        B->>S: Execute searches
        S-->>B: Search results
        B->>F: STATE_DELTA (sources updated)

        loop Refinement (max 3 iterations)
            B->>G: Evaluate research quality
            alt Grade < B
                B->>S: Additional searches
                S-->>B: More results
            else Grade >= B
                Note over B: Escalate to next phase
            end
        end
    end

    B->>G: Compose final report
    G-->>B: Report with citations
    B->>F: TEXT_MESSAGE (final report)
    B->>F: STATE_DELTA (phase: complete)
```

## 2. Agent Hierarchy

```mermaid
graph TB
    subgraph Root["interactive_planner_agent"]
        direction TB
        P[Plan Generation]
        HITL[Human-in-the-Loop Approval]
    end

    subgraph Pipeline["research_pipeline (Sequential)"]
        direction TB
        SP[section_planner]
        SR[section_researcher]

        subgraph Loop["iterative_refinement_loop"]
            direction TB
            RE[research_evaluator]
            EC[escalation_checker]
            ES[enhanced_search_executor]
        end

        RC[report_composer]
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

## 5. Component Architecture

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

    subgraph Chat Components
        CC[CopilotChat]
        PA[PlanApproval]
        CM[CitationMessage]
    end

    subgraph Hooks
        URS[useResearchState]
        UHITL[useHumanInTheLoop]
        UCS[useCoagentState]
    end

    CK --> Layout
    Layout --> TL
    Layout --> Chat
    Layout --> SS

    Chat --> CC
    Chat --> PA
    Chat --> CM

    TL --> URS
    SS --> URS
    PA --> UHITL
    CM --> UCS
    URS --> UCS
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

## 8. Deployment Architecture

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
