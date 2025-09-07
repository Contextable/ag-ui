# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

AG-UI is a monorepo containing both TypeScript and Python SDKs for the Agent-User Interaction Protocol:

- **Root**: Project documentation and coordination files
- **`typescript-sdk/`**: TypeScript implementation with Turborepo monorepo structure
  - `packages/`: Core TypeScript packages (core, client, encoder, CLI, proto)  
  - `integrations/`: Framework integrations (LangGraph, CrewAI, Mastra, etc.)
  - `apps/`: Demo applications and tools
- **`python-sdk/`**: Python implementation with Poetry
  - `ag_ui/core/`: Core types and events (Pydantic models)
  - `ag_ui/encoder/`: Event encoding utilities for HTTP streaming
- **`docs/`**: Documentation site content

## Development Commands

### TypeScript SDK (run from `typescript-sdk/` directory)
- **Build all packages**: `pnpm build` (uses Turbo)
- **Development mode**: `pnpm dev`
- **Lint**: `pnpm lint`
- **Type checking**: `pnpm check-types`
- **Run tests**: `pnpm test`
- **Clean workspace**: `pnpm clean`

### Python SDK (run from `python-sdk/` directory)
- **Install dependencies**: `poetry install`
- **Run tests**: Navigate to specific package directory and run tests with Poetry

### Individual Package Testing
For TypeScript packages, navigate to the specific package directory (e.g., `typescript-sdk/packages/core/`) and run `pnpm run test`.

## Architecture Overview

AG-UI implements a lightweight, event-based protocol for agent-human interaction:

### Core Event Types
The protocol defines ~16 standard event types across both SDKs:
- **Message events**: Text streaming (start/content/end), thinking messages
- **Tool events**: Tool calls, arguments, results  
- **State events**: State snapshots and deltas
- **Run events**: Run lifecycle (started/finished/error)
- **Step events**: Individual step tracking

### Key Components
- **Core types**: Shared message, tool, and context schemas (Zod in TS, Pydantic in Python)
- **Event encoder**: Converts events to Server-Sent Events format for HTTP streaming
- **Protocol buffer**: Defines wire format for event serialization
- **Integrations**: Framework-specific adapters for popular agent frameworks

### Language SDKs
- **TypeScript**: Built with Zod schemas, RxJS observables, modern ESM/CJS dual exports
- **Python**: Built with Pydantic models, automatic camelCase serialization for frontend compatibility

Both SDKs provide:
1. Strongly-typed data structures for all protocol events
2. Event encoding/decoding utilities
3. Framework-specific integration helpers
4. Runtime validation and serialization

## Package Management
- TypeScript: Uses **pnpm** with Turborepo for monorepo orchestration
- Python: Uses **Poetry** for dependency management
- Node.js >= 18 required
- Python >= 3.9 required

## Testing Strategy
- TypeScript: Jest with test files in `__tests__` directories alongside source
- Python: Tests located in `tests/` directory, run via Poetry
- Integration tests verify framework compatibility across supported agent libraries
- Remember that if you can't find the python server, don't bother looking for the process to kill - it's already gone.