[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$nodePathFile = Join-Path $PSScriptRoot '.local\node-path.txt'
$nodeExe = if (Test-Path -LiteralPath $nodePathFile) { (Get-Content -LiteralPath $nodePathFile -Raw).Trim() } else { (Get-Command node.exe -ErrorAction Stop).Source }
& $nodeExe (Join-Path $PSScriptRoot 'scripts\refresh-models.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Could not refresh native model thinking options. Check Devin login and connectivity.' }
