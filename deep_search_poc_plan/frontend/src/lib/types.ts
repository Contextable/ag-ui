/**
 * Deep Search POC - TypeScript Types
 *
 * These types mirror the Pydantic models in the backend and are used
 * throughout the frontend for type safety.
 */

// ============================================================================
// Research Phases
// ============================================================================

export type ResearchPhase =
  | "planning"
  | "awaiting_approval"
  | "researching"
  | "evaluating"
  | "refining"
  | "composing"
  | "complete";

// ============================================================================
// Research Plan Types
// ============================================================================

export type ObjectiveTag = "RESEARCH" | "DELIVERABLE" | "MODIFIED" | "NEW" | "IMPLIED";

export type ObjectiveStatus = "pending" | "approved" | "rejected" | "completed";

export interface ResearchObjective {
  description: string;
  tag: ObjectiveTag;
  status: ObjectiveStatus;
}

export interface ResearchPlan {
  topic: string;
  objectives: ResearchObjective[];
  approved: boolean;
}

// ============================================================================
// Source Types
// ============================================================================

export interface Source {
  url: string;
  title: string;
  domain: string;
  short_id: string; // e.g., "src-1", "src-2"
  supported_claims: string[];
  confidence: number;
}

// ============================================================================
// Report Types
// ============================================================================

export interface ReportSection {
  title: string;
  content: string;
  sources: string[]; // Array of short_ids
}

// ============================================================================
// Evaluation Types
// ============================================================================

export type EvaluationGrade = "A" | "B" | "C" | "D" | "F";

export interface ResearchEvaluation {
  grade: EvaluationGrade;
  feedback: string;
  gaps: string[];
  suggested_queries: string[];
  pass: boolean;
}

// ============================================================================
// Complete Research State
// ============================================================================

export interface ResearchState {
  phase: ResearchPhase;
  research_plan: ResearchPlan | null;
  report_sections: ReportSection[];
  section_research_findings: Record<string, string>;
  research_evaluation: ResearchEvaluation | null;
  sources: Record<string, Source>; // short_id -> Source
  current_iteration: number;
  max_iterations: number;
  final_report: string | null;
}

// ============================================================================
// Human-in-the-Loop Types
// ============================================================================

export interface PlanApprovalArgs {
  plan: ResearchPlan;
}

export interface PlanApprovalResponse {
  approved: boolean;
  plan?: ResearchPlan;
  feedback?: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

export type EffortLevel = "low" | "medium" | "high";

export interface ResearchConfig {
  effort_level: EffortLevel;
  max_iterations: number;
  model_preference?: string;
}

// ============================================================================
// Event Types (for custom event handling)
// ============================================================================

export interface SourceDiscoveredEvent {
  type: "source_discovered";
  source: Source;
}

export interface PhaseChangedEvent {
  type: "phase_changed";
  from: ResearchPhase;
  to: ResearchPhase;
}

export interface IterationCompletedEvent {
  type: "iteration_completed";
  iteration: number;
  evaluation: ResearchEvaluation;
}

export type ResearchEvent =
  | SourceDiscoveredEvent
  | PhaseChangedEvent
  | IterationCompletedEvent;
