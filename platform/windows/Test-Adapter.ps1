[CmdletBinding()]
param([switch]$Live)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$nodeExe = (Get-Content -LiteralPath (Join-Path $ProjectRoot '.local\node-path.txt') -Raw).Trim()
& (Join-Path $ProjectRoot 'bin\grok.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'Launcher check failed.' }
$testFile = if ($Live) { 'scripts\test-live.mjs' } else { 'scripts\smoke.mjs' }
& $nodeExe (Join-Path $ProjectRoot $testFile) --launcher
if ($LASTEXITCODE -ne 0) { throw 'Adapter check failed.' }
