# Bharat Milan Chat

Independent, media-only private chat for accepted Bharat Milan interest pairs. This repository deliberately contains **no changes** to the existing Bharat Milan project.

## Current phase status

- Independent server, web client, PostgreSQL schema, private Google Cloud Storage adapter, and Socket.IO authorization boundary: implemented.
- Local demo identities and accepted/pending/rejected eligibility simulator: implemented.
- Original Bharat Milan inspection/integration: blocked pending authenticated source access; no original files were changed.
- Actual GCS upload and PostgreSQL integration tests: require your local credentials and database.

## Requirements

- Node.js 20+ (Node 24 is also supported)
- PostgreSQL 15+
- A private Google Cloud Storage bucket for real uploads

## Windows PowerShell quick start

```powershell
Set-Location 'C:\path\to\bharat-milan-chat'
Copy-Item .env.example .env
.\scripts\setup.ps1
.\scripts\start.ps1
```

Open `http://localhost:5173`. Choose Demo User A or Demo User B. The demo control can set their relationship to pending, rejected, or accepted. Uploads require a configured GCS bucket; the app never falls back to local-disk media storage.

Run checks with:

```powershell
.\scripts\check.ps1
```

## Production safety

`DEMO_MODE=true` or `DEMO_ELIGIBILITY_MODE=true` makes the server refuse to start when `NODE_ENV=production`. Production eligibility calls the configured Bharat Milan backend and fails closed on a timeout, non-2xx response, or malformed response. It never accepts user-supplied interest status.

## Google Cloud Storage

1. Create a private bucket and enable the Cloud Storage API.
2. For local development authenticate with `gcloud auth application-default login`.
3. Give the runtime identity only object create/read/delete rights for that bucket; do not grant bucket-admin.
4. Set `GCS_BUCKET` in `.env` and keep `GCS_SIGNED_URL_TTL_SECONDS` short.

Media object names are random UUID paths. The browser only receives a short-lived signed URL after the server verifies current conversation membership and eligibility. Never make the bucket public.

## Architecture

`web` authenticates to `server`; `server` independently establishes identity, checks the eligibility provider, persists metadata in the chat PostgreSQL database, writes blobs exclusively to GCS, and publishes a saved message via Socket.IO. The original Bharat Milan service remains the sole authority on accepted interests in production.

## Original-project integration

No exact original files can yet be named because the referenced repository is not accessible anonymously. The proposed integration is a single protected backend endpoint/service that receives two existing user IDs from the chat backend, authenticates that caller, checks the actual accepted-interest row in either direction, and returns `{ eligible: boolean }`. It must fail closed and return no profiles or secrets. No CSS, frontend, database migration, or auth rewrite is proposed.
