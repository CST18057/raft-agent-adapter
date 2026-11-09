[CmdletBinding()]
param([switch]$Live)
$ErrorActionPreference = 'Stop'
$nodeExe = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '.local\node-path.txt') -Raw).Trim()
& (Join-Path $PSScriptRoot 'bin\grok.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'Launcher check failed.' }
$testFile = if ($Live) { 'scripts\test-live.mjs' } else { 'scripts\smoke.mjs' }
& $nodeExe (Join-Path $PSScriptRoot $testFile) --launcher
if ($LASTEXITCODE -ne 0) { throw 'Adapter check failed.' }
