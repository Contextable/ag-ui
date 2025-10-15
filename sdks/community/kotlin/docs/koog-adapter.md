# Koog Adapter Alpha

Milestone 2 of the Koog ↔ AG-UI roadmap introduces a JVM-focused adapter layer
that lets JetBrains Koog agents emit native AG-UI event streams. The adapter
lives under [`sdks/community/kotlin/integrations/koog`](../integrations/koog)
and is built entirely on top of the shared Kotlin SDK modules (`:kotlin-core`,
`:kotlin-client`, `:kotlin-tools`, `:kotlin-server`).

## What ships with M2

- **KoogStreamTranslator** – Bridges Koog `StreamFrame` output into the
  `RunAgentInput → Flow<BaseEvent>` contract expected by AG-UI servers. The
  translator handles text chunks, tool triads, state snapshots, deltas, and
  error propagation.
- **Tool bridge DSL** – A small registry builder that exposes Koog tool
  handlers with AG-UI compatible JSON schema metadata. Helpers convert
  between Koog tool invocations and AG-UI `ToolCall` / `ToolMessage` models.
- **KoogAguiAgent facade** – Wraps an arbitrary Koog runner and exposes a
  server-friendly `suspend (RunAgentInput) -> Flow<BaseEvent>` function that
  can be plugged into the [`aguiStreamingAgent`](../../library/server/src/jvmMain/kotlin/com/agui/server/AgUiStreamingEndpoint.kt)
  Ktor route for newline-delimited JSON streaming.
- **OpenAI-compatible sample** – A Docker-ready example that runs the adapter inside a
  container while talking to an Ollama model hosted in a sibling container.
  The sample targets a generic OpenAI-compatible endpoint (`MODEL_RUNNER_BASE_URL`)
  so it can be pointed at Ollama, Docker Model Runner, or hosted OpenAI-style
  services. A dedicated Ollama client exists in Koog for users who need
  platform-specific features.

## Next steps

Future milestones will layer in persistence, richer observability, and shared
contract tests that replay Koog fixtures against the TypeScript Dojo.
