# Production image for the AG-UI Google Workspace Add-on (TS).
#
# Build context: this typescript/ subfolder. Designed to "just work" when
# Railway (or any container platform) is pointed at the subfolder — no
# monorepo Root Directory tweaking required.
#
# This means the build installs @ag-ui/core, @ag-ui/client, and
# @ag-ui/a2ui-middleware from the npm registry rather than the workspace.
# Trade-off: you can't test unpublished workspace changes via this image
# (publish first, then redeploy). For active workspace-package development,
# use `pnpm dev` outside the container.
#
# Local build:
#   cd integrations/community/google-workspace/typescript
#   docker build -t ag-ui-gws-addon .

# ---- Stage 1: build ----
FROM node:20-slim AS builder
WORKDIR /app

# Copy build inputs first so the install layer caches when only source
# changes. vitest.config.ts isn't needed in the production build.
COPY package.json tsconfig.json tsdown.config.ts ./

# Rewrite package.json for npm:
#   1. Hoist peerDependencies into dependencies. The standard monorepo
#      integration pattern declares @ag-ui/* and rxjs as peers so registry
#      consumers can pin one version (see CHANGELOG). For a self-contained
#      container they need to be installed locally.
#   2. Strip the `workspace:*` entries from devDependencies. They mirror
#      the peers for in-repo pnpm linking, but npm doesn't speak the
#      `workspace:` protocol and the install fails with EUNSUPPORTEDPROTOCOL.
#      The real versions came in via the hoist in step 1.
# Doing this in the Dockerfile rather than the source package.json keeps
# the published npm package well-formed.
RUN node -e "\
  const fs = require('fs');\
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));\
  p.dependencies = { ...(p.dependencies || {}), ...(p.peerDependencies || {}) };\
  delete p.peerDependencies;\
  const stripWs = (obj) => Object.fromEntries(\
    Object.entries(obj || {}).filter(([_, v]) => typeof v !== 'string' || !v.startsWith('workspace:'))\
  );\
  p.devDependencies = stripWs(p.devDependencies);\
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2));\
"

# Install runtime + build-time deps. --legacy-peer-deps tolerates the
# transitive peer-version mismatches that don't matter for our use.
RUN npm install --legacy-peer-deps

# Now copy source and build.
COPY src ./src
RUN npx tsdown

# Drop devDependencies so the runtime stage copies a lean node_modules.
RUN npm prune --omit=dev --legacy-peer-deps

# ---- Stage 2: lean runtime ----
FROM node:20-slim AS runtime
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Static assets the /assets/* route serves (e.g. the add-on logo). These
# live alongside src/ in the source tree, not inside dist/.
COPY assets ./assets

ENV NODE_ENV=production
# Railway dynamically assigns PORT; src/index.ts reads process.env.PORT.
EXPOSE 8080

CMD ["node", "dist/index.js"]
