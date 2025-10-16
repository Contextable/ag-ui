# Koog Ollama Sample Agent

This sample shows how to expose a JetBrains Koog style agent over the AG-UI protocol while delegating language
model calls to an Ollama container. The project runs a Ktor server that streams AG-UI compliant SSE events using
the Kotlin SDK's Koog adapter.

## Running locally

From `sdks/community/kotlin/library/` run:

```bash
./gradlew :examples:koog-ollama:run --args=""
```

Set the following environment variables as needed:

- `MODEL_RUNNER_BASE_URL` – Base URL for Ollama's OpenAI-compatible API (defaults to `http://ollama:11434/v1`).
- `MODEL_RUNNER_CHAT_MODEL` – Ollama model identifier (defaults to `llama3`).
- `SYSTEM_PROMPT` – Optional system prompt injected before user messages.
- `SERVER_PORT` – HTTP port for the SSE service (defaults to `8080`).

The server exposes two endpoints:

- `GET /health` – Liveness probe.
- `POST /agent/stream` – AG-UI compliant SSE endpoint that accepts `RunAgentInput` payloads and streams events.

## Docker Compose

The repository includes a `docker-compose.yaml` and `Dockerfile` so the Koog agent can run alongside an Ollama
container. The agent service mounts the local project, builds the runnable jar, and exposes port `8080`.
