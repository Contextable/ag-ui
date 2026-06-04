# Production image for the AG-UI Google Workspace Add-on (TS).
#
# Build context: the AG-UI monorepo root.
# In Railway: set the service's Root Directory to the repo root (default)
# and Dockerfile Path to integrations/community/google-workspace/typescript/Dockerfile.
#
# Local build:
#   docker build \
#     -f integrations/community/google-workspace/typescript/Dockerfile \
#     -t ag-ui-gws-addon .

# ---- Stage 1: build via the pnpm workspace ----
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /repo

# Copy the whole monorepo. tsdown needs the workspace-linked @ag-ui/* sources
# at build time to produce a working dist. .dockerignore (sibling file) keeps
# node_modules and build artifacts out of the context.
COPY . .

# Install only what's needed to build the target package + its workspace deps.
RUN pnpm install --frozen-lockfile \
      --filter "@ag-ui/google-workspace..." \
      --filter "@ag-ui/google-workspace"

RUN pnpm --filter "@ag-ui/google-workspace" build

# ---- Stage 2: lean runtime image ----
FROM node:20-slim AS runtime

WORKDIR /app

# Bring in the build output and the static assets the /assets/* route serves.
COPY --from=builder /repo/integrations/community/google-workspace/typescript/dist ./dist
COPY --from=builder /repo/integrations/community/google-workspace/typescript/assets ./assets
COPY --from=builder /repo/integrations/community/google-workspace/typescript/package.json ./

# The package declares @ag-ui/core, @ag-ui/client, @ag-ui/a2ui-middleware,
# and rxjs as peerDependencies (matches the standard monorepo integration
# pattern, see CHANGELOG). For a standalone runtime image those peers have
# to be installed. Hoist them into `dependencies` so a plain `npm install
# --omit=dev` resolves them from the registry.
RUN node -e " \
  const fs = require('fs'); \
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
  p.dependencies = { ...(p.dependencies || {}), ...(p.peerDependencies || {}) }; \
  delete p.peerDependencies; \
  delete p.devDependencies; \
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2)); \
"
RUN npm install --omit=dev --omit=optional --legacy-peer-deps

ENV NODE_ENV=production
# Railway dynamically assigns PORT; the app reads process.env.PORT
# (default 8080 in src/index.ts) so no override needed here.
EXPOSE 8080

CMD ["node", "dist/index.js"]
