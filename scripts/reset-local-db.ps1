param([switch]$ConfirmReset)
$ErrorActionPreference = 'Stop'
if (-not $ConfirmReset) { throw 'Refusing to reset data. Re-run with -ConfirmReset only for the local development database.' }
if ($env:NODE_ENV -eq 'production') { throw 'Refusing to run against production.' }
& npm.cmd run db:migrate
& npm.cmd run db:seed
Write-Host 'Migrations and demo seed data applied. This script does not drop databases automatically.'
