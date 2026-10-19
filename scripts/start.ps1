$ErrorActionPreference = 'Stop'
if (-not (Test-Path '.env')) { throw 'Missing .env. Run .\scripts\setup.ps1 first.' }
$project = Join-Path $PSScriptRoot '..'
$server = Start-Process -FilePath 'npm.cmd' -ArgumentList '--prefix','apps/server','run','dev' -WorkingDirectory $project -WindowStyle Hidden -PassThru
$web = Start-Process -FilePath 'npm.cmd' -ArgumentList '--prefix','apps/web','run','dev' -WorkingDirectory $project -WindowStyle Hidden -PassThru
Write-Host "Server process ID: $($server.Id); web process ID: $($web.Id). Open http://localhost:5173."
