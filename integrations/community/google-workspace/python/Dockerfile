# Production image for the AG-UI Google Workspace Agent (Python ADK backend).
#
# Build context: the AG-UI monorepo root.
# In Railway: set the service's Root Directory to the repo root (default)
# and Dockerfile Path to integrations/community/google-workspace/python/Dockerfile.
#
# pyproject.toml pins ag-ui-adk as an editable local dep at
#   ../../../adk-middleware/python
# so the build needs both the python subproject and the adk-middleware
# sibling — repo-root build context makes that work.
#
# Local build:
#   docker build \
#     -f integrations/community/google-workspace/python/Dockerfile \
#     -t ag-ui-gws-agent .

FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_PYTHON_DOWNLOADS=never

# Git is needed because pyproject.toml pins `a2ui-agent-sdk` to a git ref
# (github.com/google/A2UI@609ab52). uv shells out to `git clone` for that
# kind of source; python:3.12-slim doesn't ship git, so without this the
# build fails with "Git executable not found".
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# uv is the project's package manager. Installed system-wide so the runtime
# can `uv run` without bootstrapping.
RUN pip install --no-cache-dir uv

# Mirror the relevant slice of the monorepo so uv.lock's relative path to
# the editable adk-middleware dep resolves correctly.
WORKDIR /repo
COPY integrations/adk-middleware/python ./integrations/adk-middleware/python
COPY integrations/community/google-workspace/python ./integrations/community/google-workspace/python

WORKDIR /repo/integrations/community/google-workspace/python

# Install pinned deps from uv.lock, excluding the dev group. --frozen
# fails the build if uv.lock is out of date relative to pyproject.toml,
# matching CI semantics.
RUN uv sync --frozen --no-dev

# Railway dynamically assigns PORT; the server reads $PORT (default 8001).
EXPOSE 8001

# Shell form so $PORT expands at container start.
#
# `--host ::` is intentional. Railway's private networking is IPv6-only:
# `<service>.railway.internal` resolves to an IPv6 address, so binding to
# `0.0.0.0` (IPv4 all-interfaces) means the agent listens but is
# unreachable from sibling services, surfacing as ECONNREFUSED on the
# caller. Binding to `::` accepts IPv6 *and* IPv4 (dual-stack), so this
# also works for local Docker runs that hit `localhost`.
CMD ["sh", "-c", "uv run uvicorn ag_ui_google_workspace_agent.server:app --host :: --port ${PORT:-8001}"]
