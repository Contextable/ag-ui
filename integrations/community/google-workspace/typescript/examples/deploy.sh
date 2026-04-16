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

echo "==> Generating deployment descriptor with BASE_URL=${BASE_URL}"

cat > /tmp/ag-ui-deployment.json <<EOF
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.addons.execute",
    "https://www.googleapis.com/auth/gmail.addons.current.message.metadata",
    "https://www.googleapis.com/auth/gmail.addons.current.message.readonly",
    "https://www.googleapis.com/auth/gmail.addons.current.action.compose",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.addons.execute",
    "https://www.googleapis.com/auth/calendar.addons.current.event.read",
    "https://www.googleapis.com/auth/calendar.addons.current.event.write",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive.file"
  ],
  "addOns": {
    "common": {
      "name": "AG-UI Agent",
      "logoUrl": "https://www.gstatic.com/images/branding/product/2x/google_cloud_48dp.png",
      "homepageTrigger": {
        "runFunction": "${BASE_URL}/homepage"
      }
    },
    "gmail": {
      "contextualTriggers": [
        {
          "unconditional": {},
          "onTriggerFunction": "${BASE_URL}/gmail/contextual"
        }
      ],
      "composeTrigger": {
        "selectActions": [
          {
            "runFunction": "${BASE_URL}/gmail/compose"
          }
        ],
        "draftAccess": "METADATA"
      }
    },
    "calendar": {
      "currentEventAccess": "READ_WRITE",
      "eventOpenTrigger": {
        "runFunction": "${BASE_URL}/calendar/contextual"
      }
    },
    "docs": {
      "homepageTrigger": {
        "runFunction": "${BASE_URL}/homepage"
      },
      "onFileScopeGrantedTrigger": {
        "runFunction": "${BASE_URL}/docs/file-scope-granted"
      }
    }
  }
}
EOF

echo "==> Deployment descriptor written to /tmp/ag-ui-deployment.json"
cat /tmp/ag-ui-deployment.json
echo ""

echo "==> Getting Workspace Add-ons service account..."
gcloud workspace-add-ons get-authorization 2>/dev/null || true

echo ""
echo "==> Creating/replacing deployment 'ag-ui-agent'..."
if gcloud workspace-add-ons deployments describe ag-ui-agent &>/dev/null; then
  gcloud workspace-add-ons deployments replace ag-ui-agent \
    --deployment-file=/tmp/ag-ui-deployment.json
  echo "==> Deployment updated."
else
  gcloud workspace-add-ons deployments create ag-ui-agent \
    --deployment-file=/tmp/ag-ui-deployment.json
  echo "==> Deployment created."
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
