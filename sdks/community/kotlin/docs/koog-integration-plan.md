# Koog ↔ AG-UI Kotlin SDK Integration Plan

## 0. Objectives & Constraints
- Deliver a Kotlin Multiplatform SDK that lets JetBrains Koog agents speak native AG-UI event streams while remaining idiomatic to Koog’s `AIAgent`/strategy pipeline.
- Preserve AG-UI compatibility (`RunAgentInput -> Observable<BaseEvent>`) across transports (SSE, HTTP binary) as described in `docs/concepts/architecture.mdx`.
- Lean on Koog’s strengths (type-safe `ToolRegistry`, graph strategies, streaming `Flow<StreamFrame>`, persistence, observability) without forcing AG-UI users to adopt Koog directly.
- Keep the integration modular: Koog-specific code must live in an optional adapter layer, so a future non-Koog JVM agent can still use the base SDK.
- Work within the existing repo tooling (pnpm docs, TypeScript Dojo) while adding Gradle-based Kotlin builds, CI hooks, and documentation.

## 1. Repository & Build Scaffolding
1. Leverage the existing AG-UI Kotlin SDK modules in `sdks/community/kotlin/library`—`:kotlin-core`, `:kotlin-client`, and `:kotlin-tools`—as the foundation. Catalogue current capabilities and document any gaps (especially around server-side `RunAgent` execution).
2. When core functionality is missing (e.g., hosting an AG-UI compliant SSE endpoint), extend the community SDK itself by introducing additional source sets and a dedicated `:kotlin-server` module inside `library/`. Make this module a first-class deliverable, covering server transports (SSE, LocalAgent integration points) and publishing it with the rest of the Kotlin artifacts.
3. Create a Koog-specific adapter workspace under `sdks/community/kotlin/integrations/koog`, depending only on the community Kotlin SDK modules. Place samples (Spring Boot, Ktor) beside the adapter here so they naturally consume the shared runtime.
4. Confirm the existing Gradle Kotlin Multiplatform configuration meets Koog requirements; layer in any missing plugins (Dokka, detekt/ktlint) and testing dependencies (JUnit 5, Turbine) as shared build logic rather than per-integration overrides.
5. Update CI to run the community Kotlin SDK checks (`./gradlew :kotlin-core:check`, etc.) plus the Koog integration module, ensuring the new `:kotlin-server` module and LocalAgent tests are covered. Align publishing metadata (Maven coordinates, version strategy) with the rest of the Kotlin SDK.

## 2. AG-UI Core Modeling
1. Audit the existing Kotlin SDK models for `RunAgentInput`, event hierarchies, tool definitions, and ensure they already satisfy Koog integration needs. Where gaps exist (e.g., missing helper builders or server-facing DTOs), add them directly to `:kotlin-core`.
2. Augment existing serializers only when necessary—e.g., introduce additional polymorphic registrations or server-side payload encoders in `:kotlin-core`—keeping parity with the official AG-UI JSON schema and any binary codecs already defined.
3. Extend validation utilities in the base SDK to cover Koog-specific usage patterns (thread/run ID propagation, tool metadata completeness) so the adapter does not reimplement core rules.
4. Expand unit tests within the community Kotlin SDK to cover any new scenarios uncovered during the audit, using fixtures shared with the TypeScript SDK to guarantee round-trip fidelity.

## 3. Transport Layer
1. Verify the community Kotlin SDK already exposes the `RunAgentInput -> Flow<BaseEvent>` contract (e.g., via `AguiAgent`). If gaps exist, address them by enhancing the existing abstractions rather than inventing a new `AguiAgentRunner` type.
2. Enhance the shared transport utilities (likely within `:kotlin-client` or a new `:kotlin-server`) to host an AG-UI compliant SSE endpoint: accepting POST `RunAgentInput`, streaming Server-Sent Events with correct IDs/fields, and providing hooks for auth/logging/request tracing.
3. Introduce an in-memory `LocalAgent` alongside `HttpAgent` within the community Kotlin SDK, enabling clients and agents to run inside the same process without network hops; expose a consistent API (`runAgent` returning `Flow<BaseEvent>`) while reusing the shared serialization and lifecycle hooks.
4. Confirm the JVM client transport meets Koog consumption needs; add reconnection/backpressure improvements in the shared library rather than in the adapter.
5. Keep binary transport support on the backlog, but document expectations inside the community SDK so both core and adapter users understand the roadmap.
6. Build integration tests inside the community Kotlin SDK (embedded Ktor server + client, plus LocalAgent loopback) that validate end-to-end streaming; reuse them from the Koog adapter to avoid duplicate coverage.

## 4. Koog Adapter Layer
1. Event Translation
   - Create `KoogStreamTranslator` to consume Koog `Flow<StreamFrame>` + `SessionEventProcessor` outputs and emit `BaseEvent` sequences.
   - Mapping specifics:
     - `StreamFrame.Append` → message chunk events (prefer AG-UI `TEXT_MESSAGE_CHUNK` support, while still emitting triad markers when downstream clients expect them).
     - `StreamFrame.ToolCall` → `TOOL_CALL_*` triad; include Koog tool metadata from `ToolCallInfo`.
     - `StreamFrame.End` + Koog lifecycle hooks → `RUN_FINISHED` + optional `STATE_SNAPSHOT`.
     - Koog storage updates/persistence signals → map to `STATE_DELTA` (`JSON Patch`) where possible, fallback to `RAW` events for opaque payloads.
2. Tool Bridge
   - Provide DSL to register Koog `ToolRegistry` entries that expose AG-UI-compatible schemas (names, JSON schema for args/results).
   - Implement converters `KoogToolCall -> AguiToolInvocation` and `AguiToolResponse -> ToolResultMessage`.
   - Document how Koog’s `RollbackToolRegistry` can be optionally wired to AG-UI session management so that, if future runtime orchestration introduces rewind capabilities on the server side, the adapter already provides the necessary hooks (no new AG-UI protocol feature is implied here).
3. Execution Facade
   - Provide `KoogAguiAgent` class wrapping an `AIAgent` and exposing `AguiAgentRunner`.
   - Handle thread/run correlation: derive Koog `contextId` from AG-UI `threadId`; propagate `runId` into `AIAgentStorage` or metadata node.
   - Offer configuration builder for installing Koog features (`Persistence`, `AgentMemory`, `OpenTelemetry`, `Debugger`) with sensible defaults, and allow callers to supply either HTTP transports or the new in-memory `LocalAgent` for co-located execution.
4. Strategy Templates
   - Ship ready-made Koog `AIAgentStrategy` implementations for common AG-UI patterns: basic chat, ReAct with tools, structured output.
   - Provide extension nodes (`nodeEmitAguiState`, `nodeRecordAguiMessage`) to simplify linking Koog graphs to AG-UI events.
5. Observability
   - Bridge Koog `Tracing`/`OpenTelemetry` spans into AG-UI `RAW` diagnostic events when enabled.
   - Surface Langfuse exporter configuration aligned with AG-UI run metadata.
6. Error Handling
   - Normalize Koog exceptions into `RUN_ERROR` events with structured payloads; include Koog `ErrorReport` details.

## 5. Persistence & Memory Integration
1. Offer persistence configuration options mirroring AG-UI expectations:
   - Automatic checkpointing per event batch so server operators can recover long-lived runs if they choose to.
   - Expose APIs (server-side only) that allow orchestrators to request rewind/restore by calling Koog’s persistence layer—this is an optional capability for backends; it does not introduce new AG-UI protocol messages.
2. Provide adapters for Koog `AgentMemory` to emit `STATE_SNAPSHOT` events containing memory highlights / facts relevant to UI.
3. Document recommended storage providers (in-memory for samples, file/SQL for production) and include sample implementations.

## 6. Testing Strategy
1. Unit tests per module (core models, transports, Koog adapter) with high coverage.
2. Contract tests vs. TypeScript reference:
   - Use recorded AG-UI event fixtures from Dojo to ensure Kotlin serialization parity.
   - Spin up sample Koog agent and consume via AG-UI TypeScript client in JVM/Node integration tests (Gradle task invoking PNPM script if needed).
3. Performance smoke tests comparing Koog streaming throughput vs. AG-UI SSE expectations; track backpressure, latency.
4. Regression suite for persistence & rollback, ensuring no orphaned tool side-effects.

## 7. Documentation & Samples
1. Author Kotlin README covering setup, module overview, and quickstart.
2. Document the new in-process `LocalAgent` (API overview, when to prefer it, limitations) and include minimal sample code.
3. Produce tutorial: "Serve a Koog agent over AG-UI" with Spring Boot starter (auto-configured `KoogAguiAgentController`).
4. Produce Ktor-based sample showing lightweight deployment.
5. Update `docs/integrations.mdx` with Kotlin/Koog section, cross-link to plan and future API docs.
6. Record architecture diagrams (Mermaid + PNG) showing end-to-end data flow.

## 8. Release & Maintenance Checklist
1. Define versioning policy (align with AG-UI minor releases, semantic versioning across Kotlin modules).
2. Set up publishing (Maven Central or GitHub Packages) with automation scripts and credentials placeholders.
3. Establish contribution guidelines for Kotlin SDK (code style, testing expectations, release process).
4. Plan long-term enhancements backlog: JS/Native targets, WebSockets transport, multi-agent coordination, Koog A2A client bridging.

## 9. Risks & Mitigations
- **Streaming mismatch**: Koog emits typed frames; mitigate by mapping to AG-UI message chunks first (leveraging chunk support) and adding triad wrappers only when consumers require them. Back this with replay fixtures and contract tests.
- **Tool schema drift**: Koog tools may have Kotlin-specific types. Provide explicit JSON schema mapping + validation during registration.
- **Persistence complexity**: Ensure rollback semantics are optional and well-documented; start with in-memory provider.
- **CI weight**: Kotlin + TypeScript tests may increase run time. Cache Gradle + pnpm artifacts, split workflows by matrix.
- **Binary protocol parity**: Treat as scoped backlog; document limitations so adopters rely on SSE initially.

## 10. Milestones
1. **M1 – Core SDK (Week 1-2)**: Community Kotlin SDK gaps resolved (models/utilities/transport), core SSE server/client verified, baseline tests updated.
2. **M2 – Koog Adapter Alpha (Week 3-4)**: `KoogAguiAgent`, stream translator, tool bridge, sample agent streaming to AG-UI Dojo.
3. **M3 – Persistence & Observability (Week 5)**: Persistence hooks, AgentMemory exposure, OpenTelemetry integration, regression tests.
4. **M4 – Documentation & Release Prep (Week 6)**: Samples polished, docs published, CI green, release candidate artifacts.
