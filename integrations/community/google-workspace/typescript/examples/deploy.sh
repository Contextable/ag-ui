#!/usr/bin/env bash
#
# Deploy the AG-UI Workspace Add-on for testing.
#
# Usage:
#   ./deploy.sh https://your-ngrok-url.ngrok.dev
#   ./deploy.sh https://your-cloudrun-url.run.app
#
# Prerequisites:
#   - gcloud CLI authenticated
#   - APIs enabled: gsuiteaddons.googleapis.com, gmail.googleapis.com
#

set -euo pipefail

BASE_URL="${1:?Usage: ./deploy.sh <BASE_URL>}"

# Strip trailing slash
BASE_URL="${BASE_URL%/}"

# Source of truth for the deployment descriptor. We template $BASE_URL into
# the copy at examples/deployment.json — any edits you make there (logoUrl,
# scopes, triggers) flow through this deploy.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/deployment.json"

if [ ! -f "${TEMPLATE}" ]; then
  echo "ERROR: template not found at ${TEMPLATE}" >&2
  exit 1
fi

echo "==> Rendering deployment descriptor from ${TEMPLATE} with BASE_URL=${BASE_URL}"

# Substitute \$BASE_URL (and ${BASE_URL}) — the descriptor uses \$BASE_URL
# as a placeholder per Google's add-on conventions.
sed -e "s|\$BASE_URL|${BASE_URL}|g" -e "s|\${BASE_URL}|${BASE_URL}|g" \
  "${TEMPLATE}" > /tmp/ag-ui-deployment.json

echo "==> Deployment descriptor written to /tmp/ag-ui-deployment.json"
cat /tmp/ag-ui-deployment.json
echo ""

echo "==> Getting Workspace Add-ons service account..."
gcloud workspace-add-ons get-authorization 2>/dev/null || true

echo ""
echo "==> Creating/replacing deployment 'ag-ui-agent'..."
# Prefer `replace` when the deployment already exists. If `describe`
# returns non-zero (not found, auth glitch, etc.), fall back to `create`;
# if that hits a conflict because the deployment does exist after all,
# retry with `replace`.
if gcloud workspace-add-ons deployments describe ag-ui-agent &>/dev/null; then
  gcloud workspace-add-ons deployments replace ag-ui-agent \
    --deployment-file=/tmp/ag-ui-deployment.json
  echo "==> Deployment updated."
else
  if ! gcloud workspace-add-ons deployments create ag-ui-agent \
      --deployment-file=/tmp/ag-ui-deployment.json 2>/tmp/ag-ui-create.err; then
    if grep -q "already exists" /tmp/ag-ui-create.err; then
      echo "    create hit 'already exists' — retrying as replace..."
      gcloud workspace-add-ons deployments replace ag-ui-agent \
        --deployment-file=/tmp/ag-ui-deployment.json
      echo "==> Deployment updated."
    else
      cat /tmp/ag-ui-create.err >&2
      exit 1
    fi
  else
    echo "==> Deployment created."
  fi
fi

echo ""
echo "==> Installing on your account..."
gcloud workspace-add-ons deployments install ag-ui-agent 2>/dev/null || echo "(already installed)"

echo ""
echo "==> Done! Open Gmail and look for 'AG-UI Agent' in the right sidebar."
echo "    If you don't see it, click the puzzle piece icon on the right side of Gmail."
echo ""
echo "    To update after code changes (no redeploy needed — ngrok proxies live):"
echo "    Just restart your local server."
echo ""
echo "    To update the URL (e.g., new ngrok session):"
echo "    ./deploy.sh <NEW_URL>"
