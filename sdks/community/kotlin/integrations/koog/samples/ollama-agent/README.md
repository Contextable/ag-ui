# Koog → AG-UI Ollama Sample

This sample demonstrates how to host a JetBrains Koog agent behind an AG-UI
HTTP streaming endpoint. The agent container speaks to any OpenAI-compatible
`/v1/chat/completions` API (Ollama by default) and streams newline-delimited
JSON events back to CopilotKit/AG-UI clients.

> **Why OpenAI-compatible?** Using the generic OpenAI transport keeps the
> sample flexible across model runners. JetBrains Koog also ships an
> `OllamaClient` for feature-specific integrations if you do not need this
> portability.

## Prerequisites

- Docker 24+
- Docker Compose V2
- An Ollama model pulled locally (the compose file defaults to `llama3`)

## Environment variables

The container accepts a few knobs for local iteration:

| Variable | Purpose | Default |
|----------|---------|---------|
| `MODEL_RUNNER_BASE_URL` | OpenAI-compatible endpoint published by your model runner | `http://ollama:11434/v1` |
| `MODEL_RUNNER_CHAT_MODEL` | Model identifier passed to the API | `llama3` |
| `SYSTEM_PROMPT` | Optional system instruction injected into every request | _empty_ |
| `PORT` | HTTP port exposed by the Koog adapter | `8080` |

## Running the stack

```bash
# from ag-ui/sdks/community/kotlin/integrations/koog/samples/ollama-agent
docker compose up --build
```

The compose file launches two services:

- `ollama` – pulls the official `ollama/ollama` image and exposes port `11434`
- `koog-app` – builds the Koog adapter sample, exposes the streaming endpoint on `8080`

Once running you can post `RunAgentInput` payloads to `http://localhost:8080/agent/run`
and stream AG-UI events in real time. The project uses the [`KoogAguiAgent`](../../adapter/src/main/kotlin/com/agui/integrations/koog/agent/KoogAguiAgent.kt)
wrapper and [`KoogStreamTranslator`](../../adapter/src/main/kotlin/com/agui/integrations/koog/stream/KoogStreamTranslator.kt)
from the adapter module.

## Testing the endpoint

```bash
curl -N -H "Content-Type: application/json" \
  -d '{"threadId":"demo-thread","runId":"demo-run","messages":[{"type":"user","id":"msg-1","content":"Explain Kotlin multiplatform."}]}' \
  http://localhost:8080/agent/run
```

The response is an AG-UI compliant newline-delimited JSON stream that can be
consumed by the TypeScript client or the AG-UI Dojo.

## Building without Docker

```bash
cd ../../../../library
./gradlew :kotlin-koog-sample-ollama:run
```

This launches the server on port 8080 with the same environment variables described
above.
