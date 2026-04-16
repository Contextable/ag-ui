# Deployment Guide — Google Workspace Add-on

This guide walks through deploying the AG-UI Workspace Add-on for **testing on your own Google account**. Production publication to the Marketplace is a separate process that requires Google verification.

This guide captures every step needed including several that are **not obvious from Google's documentation**.

---

## Prerequisites

- A Google Cloud project (free tier works)
- A Google account — works with Workspace business accounts; consumer @gmail.com accounts can install but the **App Visibility** options below differ
- `gcloud` CLI installed and authenticated as the account that will use the add-on
- A public HTTPS URL for your add-on server (Cloud Run or `ngrok`)
- Your AG-UI backend running and accessible

---

## Step 1: Enable APIs

```bash
gcloud services enable \
  gsuiteaddons.googleapis.com \
  gmail.googleapis.com \
  calendar-json.googleapis.com \
  docs.googleapis.com \
  chat.googleapis.com \
  appsmarket-component.googleapis.com
```

The last one — **`appsmarket-component.googleapis.com`** (Google Workspace Marketplace SDK) — is **required even for test deployments**. Without it, you'll see "OAuth client not found" errors.

---

## Step 2: Configure the OAuth Consent Screen (Branding)

Go to: **https://console.cloud.google.com/auth/branding**

1. Click **Get Started** if it's not configured yet
2. Fill in:
   - **App name**: `AG-UI Agent`
   - **User support email**: your email
   - **Developer contact email**: your email
3. Click **Save**

---

## Step 3: Set Audience to Internal

Go to: **https://console.cloud.google.com/auth/audience**

- Select **Internal** (only available for Workspace orgs — for personal Gmail, select External and add your account as a test user)
- Click **Save**

---

## Step 4: Add Required OAuth Scopes

Go to: **https://console.cloud.google.com/auth/scopes**

Click **Add or Remove Scopes** and add ALL of these:

**Always required** (and MUST also be listed in the deployment descriptor's `oauthScopes` so they're included in the token Google sends to your add-on — needed by the user identity lookup):
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

**For Gmail:**
- `https://www.googleapis.com/auth/gmail.addons.execute`
- `https://www.googleapis.com/auth/gmail.addons.current.message.metadata`
- `https://www.googleapis.com/auth/gmail.addons.current.message.readonly`
- `https://www.googleapis.com/auth/gmail.addons.current.action.compose`
- `https://www.googleapis.com/auth/gmail.compose` (sensitive — needed to create drafts via the Gmail API for `draft_reply`)
- `https://www.googleapis.com/auth/gmail.readonly` (sensitive — needed for `search_inbox` to query messages outside the current addon context, and for `read_emails` to fetch full message bodies by ID)

**For Calendar:**
- `https://www.googleapis.com/auth/calendar.addons.execute`
- `https://www.googleapis.com/auth/calendar.addons.current.event.read`
- `https://www.googleapis.com/auth/calendar.addons.current.event.write`
- `https://www.googleapis.com/auth/calendar.events` (sensitive — needed for `read_event_details`, `update_event_description`, `update_event_title`, `reschedule_event`, `create_event`, and `get_upcoming_events`)

**For Docs:**
- `https://www.googleapis.com/auth/drive.file` (per-file access — Google prompts the user for each individual document)

> ⚠️ **The `*.addons.execute` scopes are required by Gmail/Calendar add-ons and are easy to miss** — they don't appear in basic examples but the framework will refuse to load the add-on without them.

> **Optimistic consent (how scopes actually get granted)**: the add-on does NOT pre-check scopes upfront. Instead, tools attempt their Google API call; if the API returns 403, the tool returns a `requesting_google_scopes` action response and Google shows the user a native consent prompt for the missing scope. Once granted, the user's original message is preserved in the session and pre-filled on return, so the flow continues smoothly without the user re-typing. This means:
> - Users only see consent prompts for scopes the tools actually need
> - Granting happens on first use, not on add-on install
> - All three surfaces (Gmail, Calendar, Docs) use the same pattern

Click **Save**.

---

## Step 5: Create an OAuth 2.0 Client ID

Go to: **https://console.cloud.google.com/auth/clients**

1. Click **Create Client**
2. Application type: **Web application**
3. Name: `AG-UI Agent`
4. Leave redirect URIs blank
5. Click **Create**

You don't need to copy the ID/secret. Google's framework just needs the client to exist in the project.

---

## Step 6: Configure the Marketplace SDK App Configuration

Go to: **https://console.cloud.google.com/apis/api/appsmarket-component.googleapis.com/googleapps_sdk**

Click the **App Configuration** tab and set:

| Field | Value |
|-------|-------|
| **App Visibility** | `Private` (your domain only) |
| **Installation Settings** | `Individual + Admin Install` |
| **App Integrations** | ✅ Check **Google Workspace Add-on** |
| **HTTP or other deployments** | Select this radio button |
| **Deployment ID** | Click **Select deployment** → choose `ag-ui-agent` (after running deploy.sh once) |

In the **OAuth Scopes** section, add the **same scopes** as Step 4. They must match what's in the OAuth consent screen.

In **Developer Information**: fill in name, email, website (e.g., your domain).

Click **Save Draft**. (The "Draft" wording is normal — drafts are used for test deployments.)

---

## Step 7: Get a Public HTTPS URL

### Option A — ngrok (fastest)

```bash
ngrok http 8000
# Copy the https://xxx.ngrok.dev URL
```

A paid ngrok plan with a static domain is recommended so you don't have to redeploy every time the URL changes.

### Option B — Cloud Run

```bash
gcloud run deploy ag-ui-workspace \
  --source=. \
  --region=us-central1 \
  --allow-unauthenticated \
  --set-env-vars="AGUI_DEFAULT_BACKEND_URL=https://your-backend.example.com"
```

---

## Step 8: Deploy the Add-on Descriptor

```bash
cd integrations/community/google-workspace/typescript
./examples/deploy.sh https://YOUR-NGROK-OR-CLOUDRUN-URL
```

This script:
1. Generates `/tmp/ag-ui-deployment.json` with your URL filled in
2. Creates or replaces the `ag-ui-agent` deployment via `gcloud workspace-add-ons`
3. Installs it on your account

---

## Step 9: Start the Server

```bash
ACTION_BASE_URL=https://YOUR-NGROK-OR-CLOUDRUN-URL \
AGUI_DEFAULT_BACKEND_URL=https://your-backend \
PORT=8000 \
npx tsx src/index.ts
```

> ⚠️ **`ACTION_BASE_URL` is required.** HTTP add-ons need every action button's `function` field to be a full HTTPS URL (not just a function name like `"handleSend"`). The card builders read this env var to build button URLs. Without it, you get a 500 "Internal error encountered" when clicking buttons.

---

## Step 10: Use the Add-on

### Gmail

1. Open https://mail.google.com (logged in as the account where you installed the add-on)
2. Hard reload (Cmd+Shift+R / Ctrl+Shift+R)
3. Look at the right sidebar — you should see the **AG-UI Agent icon** (the logo from your `logoUrl`)
4. Click it; if you don't see it directly, click the **`+` puzzle piece icon** to find it
5. Open any email — the contextual trigger fires and the sidebar populates

### Chat

The Chat app is a separate configuration (see `chat-setup.md` if needed). It uses `appsmarket-component` for app discovery and your HTTP endpoint URL configured in the Chat API page.

---

## Updating After Code Changes

Just **restart the local server**. Code changes take effect immediately because Google calls your live HTTP endpoint on every action.

### Updating after URL changes (new ngrok session)

```bash
./examples/deploy.sh https://NEW-NGROK-URL
```

### Updating after scope or descriptor changes

```bash
./examples/deploy.sh https://YOUR-URL
gcloud workspace-add-ons deployments uninstall ag-ui-agent --account=your@email.com
gcloud workspace-add-ons deployments install ag-ui-agent --account=your@email.com
```

Then hard reload Gmail.

---

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `OAuth client not found -- Is the OAuth consent screen configured?` | OAuth consent screen, OAuth client, or Marketplace SDK not set up | Complete steps 2–6 |
| `Missing required scopes: [...]` | Scope listed in error not added to OAuth consent screen | Add the listed scope at the URL in step 4 |
| Send/Settings/etc. buttons return `[13, "Internal error encountered."]` | Action button `function` is a plain string, not a URL | Set `ACTION_BASE_URL` env var when starting the server (step 9) |
| Add-on doesn't appear in Gmail sidebar | Installed for wrong account, or Gmail not reloaded | Verify `gcloud config get account` matches your Gmail; hard reload |
| `gcloud crashed (ValidationError): Expected type <class 'str'> for field onTriggerFunction` | Old descriptor format — `onTriggerFunction` should be a URL string, NOT `{ runFunction: "..." }` | Use the latest `examples/deployment.json` |
| Chat shows "AG-UI not responding" but server logs show success | Wrong response format. Workspace Add-on Chat events MUST return `hostAppDataAction`, not `{ text }` | The Chat module already handles this — make sure you're using the latest code |
| Standard markdown shows raw `**` in Chat | Chat uses non-standard markdown syntax | The Chat module's `markdownToChat` converter handles this — `**bold**` → `*bold*`, etc. |

---

## Why Each Step Matters

A few of these aren't documented well by Google. Quick reference:

1. **Marketplace SDK API enable** — Required even for test deployments because the add-on framework looks up your config there.
2. **App Configuration tab vs. HTTP Deployments tab** — The App Configuration tab has its own scope list that must match the OAuth consent screen's. Mismatches cause "Missing required scopes" errors.
3. **`*.addons.execute` scopes** — Required by the framework for any Gmail/Calendar add-on, but never appear in the simple examples. The framework error message is misleading because it says "Missing required scopes" without explaining they're framework-level.
4. **OAuth Client ID auto-generated** — The HTTP Deployments tab shows an auto-generated OAuth Client ID. You don't need to set it manually. But you DO need to have created at least one OAuth Client (step 5) for the framework's OAuth flow to work.

---

## Account Compatibility

| Account Type | Audience setting | Notes |
|-------------|------------------|-------|
| **Workspace** (business/edu) | `Internal` | Easiest — no Google review needed for org-internal use |
| **Consumer** (@gmail.com) | `External` + add yourself as test user | Required because consumer accounts can't use `Internal` audience |
