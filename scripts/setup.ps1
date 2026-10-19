$ErrorActionPreference = 'Stop'
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env'; Write-Host 'Created .env. Configure DATABASE_URL, SESSION_SECRET, and GCS_BUCKET before running the app.' }
& npm.cmd --prefix apps/server install --workspaces=false
& npm.cmd --prefix apps/web install --workspaces=false
Write-Host 'Dependencies installed. Create the PostgreSQL database, then run: npm.cmd run db:migrate; npm.cmd run db:seed'
