# Milestone 2 – Koog Adapter Alpha

Milestone 2 delivers the first Koog integration layer for the community Kotlin SDK:

- Added the `kotlin-koog` module with `KoogStreamTranslator`, `KoogAguiAgent`, and a Koog-aware tool registry DSL.
- Implemented unit tests that validate message translation and delegated tool execution.
- Shipped the `examples/koog-ollama` Ktor sample plus Docker artifacts that connect a Koog agent to an Ollama model container.
- Updated public docs to cover the adapter and listed the integration on the global integrations page.
- Bumped toolchain dependencies (Kotlin 2.2.20, Ktor 3.2.3, kotlinx-serialization-json 1.9.0, app.cash.turbine 1.2.1).
