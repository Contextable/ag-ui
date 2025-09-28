# Facebook Messenger ↔︎ AG-UI Integration PRD

## Background
Facebook Messenger reaches billions of users and offers a familiar chat UX for consumer and enterprise scenarios. Agentic systems built on AG-UI already expose a consistent HTTP/SSE protocol for creating runs and streaming responses across heterogeneous frameworks (OpenAI, Claude, LlamaIndex, etc.). A dedicated Messenger integration enables teams to reach users where they already are, without rebuilding channel-specific bot infrastructure for every agent runtime.

This project establishes a standalone repository that ships a lightweight TypeScript gateway translating Messenger webhooks into AG-UI runs, plus supporting tooling (infrastructure-as-code, deployment scripts, sample configuration) so developers can self-host or extend the connector.

## Objectives
- Deliver an open-source repository that provides an end-to-end bridge between Facebook Messenger conversations and AG-UI agents.
- Keep the implementation lightweight: reuse the existing AG-UI HTTP protocol via the `HttpAgent` helper and avoid modifying AG-UI core services.
- Provide a production-ready foundation with documentation, testing, deployment automation, and observability hooks suitable for a blog-driven walkthrough.
- Showcase the integration journey through a blog post that references the repo structure, setup steps, and extension ideas.

### Non-Goals
- Creating bespoke Messenger UX beyond the standard text, quick replies, or typing indicators.
- Extending AG-UI protocol semantics or altering its server implementation.
- Building a web frontend or Dojo integration—this repo focuses solely on Messenger ↔︎ AG-UI bridging.

## Target Users
- **Agent developers** who maintain AG-UI-compatible backends and want to expose their bots on Facebook Messenger.
- **Solution engineers** looking for a reference implementation to embed agents in social/chat channels.
- **Content creators** (blog readers) interested in the full lifecycle of shipping an integration from concept to deployment.

## User Stories
1. *As a developer*, I can clone the repository, configure environment variables for Facebook and AG-UI, and run a webhook locally (via ngrok) to chat with my agent from Messenger.
2. *As an operator*, I can deploy the gateway to a container environment (Docker Compose or Fly.io) with minimal configuration and monitor logs/metrics.
3. *As a maintainer*, I can run automated tests (unit and integration) to verify message translation logic and webhook handlers before pushing changes.
4. *As a blogger*, I can follow a documented, linear workflow (repo creation, configuration, testing, deployment) to illustrate the integration in an article.

## Scope & Deliverables
### 1. Repository Structure
```
facebook-messenger-ag-ui/
├── README.md
├── packages/
│   ├── messenger-agent/        # Lightweight SDK wrapper around HttpAgent
│   └── messenger-gateway/      # Express/Fastify webhook service
├── infra/
│   ├── docker-compose.yml
│   └── fly/
│       └── fly.toml
├── docs/
│   ├── SETUP.md
│   ├── DEPLOYMENT.md
│   └── BLOG_OUTLINE.md
└── scripts/
    ├── dev.sh
    └── verify.mjs
```

### 2. Messenger Agent Package (`packages/messenger-agent`)
- TypeScript package mirroring `HttpAgent` usage from AG-UI TypeScript SDK.
- Exports `FacebookMessengerAgent` class with convenience constructor (base URL, auth headers) and helpers for converting Messenger messages to AG-UI `UserMessage` objects.
- Includes unit tests for message normalization utilities.
- Published (optional) to npm under scoped package for reuse.

### 3. Messenger Gateway Service (`packages/messenger-gateway`)
- Fastify-based webhook with endpoints:
  - `GET /webhook` for Facebook verification.
  - `POST /webhook` to receive message events.
  - `POST /healthz` or `GET /healthz` for health checks.
- Uses `FacebookMessengerAgent` to initiate AG-UI runs per `sender.id`.
- Maintains in-memory session map (`sender.id` ↔︎ `threadId`) with pluggable storage adapter (Redis optional).
- Translates AG-UI event lifecycle:
  - `run.started` → Messenger `typing_on`.
  - `run.completed` with `assistant` messages → Messenger text payloads.
  - `run.failed` → Messenger error response with retry guidance.
  - Tool outputs → fallback text or attachments depending on event metadata.
- Sends replies via Facebook Send API with retry/backoff logic.
- Supports slash commands (`/reset`, `/help`) to reset thread or display status.
- Includes structured logging (pino) and metrics (Prometheus exporter) for observability.

### 4. Configuration & Secrets
- `.env.example` covering:
  - `FACEBOOK_APP_SECRET`
  - `FACEBOOK_VERIFY_TOKEN`
  - `FACEBOOK_PAGE_ACCESS_TOKEN`
  - `AGUI_BASE_URL`
  - `AGUI_API_KEY`
  - `SESSION_STORE` options (memory/redis URL)
- Guidance on storing secrets via Doppler, 1Password, or GitHub Actions secrets.

### 5. Tooling & CI/CD
- `pnpm` workspace managing both packages with shared lint/test commands.
- ESLint + Prettier configuration shared across packages.
- GitHub Actions workflows:
  - `ci.yml` running lint, type-check, unit tests.
  - `docker.yml` building/publishing container image on tagged releases.
- Release automation using Changesets or simple npm publish script.

### 6. Documentation
- `README.md` giving quickstart (local dev, ngrok, Messenger app setup).
- `docs/SETUP.md` deeper walkthrough with screenshots (webhook config, verifying tokens).
- `docs/DEPLOYMENT.md` instructions for Docker Compose and Fly.io.
- `docs/BLOG_OUTLINE.md` bullet list aligning with blog narrative (repo creation → first chat → deployment).
- Inline JSDoc comments for API functions.

### 7. Testing Strategy
- Unit tests for:
  - Message normalization (attachments, quick replies).
  - Session store adapters.
  - AG-UI event translation utilities.
- Integration tests using mocked Messenger webhook payloads and AG-UI responses (via MSW or nock).
- End-to-end smoke test harness that spins up the gateway against a mock AG-UI server.

### 8. Deployment Targets
- Docker Compose for local/self-hosted deployments (Messenger webhook + optional Redis).
- Fly.io app definition (`infra/fly/fly.toml`) showcasing cloud deployment.
- Guidance for serverless options (Cloudflare Workers / AWS Lambda) noting adjustments needed.

### 9. Observability
- Request/response logging with correlation IDs (Messenger `sender.id`, AG-UI `threadId`).
- Metrics:
  - `messenger_inbound_total`
  - `agui_runs_total`
  - `agui_run_duration_seconds`
  - `messenger_delivery_failures_total`
- Optional OpenTelemetry tracing integration toggle.

## Implementation Plan
1. **Repo Initialization**
   - Create GitHub repo, configure pnpm workspace, scaffold packages and shared configs.
   - Set up linting, formatting, and testing baseline.
2. **Messenger Agent Package**
   - Implement `FacebookMessengerAgent` + utilities.
   - Write unit tests and generate typedocs.
3. **Gateway Service**
   - Implement webhook endpoints, session management, AG-UI stream handling.
   - Add command handlers, logging, metrics.
   - Build integration tests.
4. **Configuration & Docs**
   - Author README and setup guides.
   - Provide `.env.example`, sample requests, ngrok instructions.
5. **Deployment Automation**
   - Create Dockerfile, docker-compose, Fly.io manifests.
   - Add GitHub Actions workflows.
6. **Final QA & Blog Prep**
   - Run end-to-end smoke tests with real Messenger sandbox.
   - Capture screenshots/logs for blog post.
   - Finalize `docs/BLOG_OUTLINE.md` referencing repo paths.

## Risks & Mitigations
- **Facebook API changes**: Monitor versioned Graph API; pin to stable version and document upgrade path.
- **Rate limits**: Implement exponential backoff and alerting when hitting Send API limits.
- **Session persistence**: Provide Redis adapter and instructions for stateless deployments.
- **Security**: Verify webhook signatures using App Secret; ensure HTTPS with recommended reverse proxy (ngrok, Fly.io).
- **AG-UI availability**: Add retries/circuit breaker when AG-UI backend is unavailable and send fallback message to users.

## Success Metrics
- Ability to complete a Messenger conversation with an AG-UI agent using the sample setup within 30 minutes following documentation.
- CI pipeline passing (lint, test, type-check) on main branch.
- At least one deployment recipe (Docker Compose) validated in README tutorial.
- Positive engagement with accompanying blog post (qualitative).

## Open Questions
- Should we publish the `messenger-agent` package independently to npm or keep it internal to the repo?
- What level of attachment/tool support is required for MVP (images, location, structured templates)?
- Do we need multi-language localization for canned responses (`/help`, error messages)?

## Appendix: Blog Post Outline
1. Motivation: connecting Messenger audiences to AG-UI agents.
2. Repo scaffolding and architecture overview.
3. Implementing the Messenger Agent package (code snippets).
4. Building the webhook gateway (verification, message flow, AG-UI streaming).
5. Running locally with ngrok and Messenger sandbox.
6. Deploying to Fly.io (optional alternative: Docker Compose on VPS).
7. Observability and operational tips.
8. Future enhancements (attachments, multi-agent routing, analytics).

