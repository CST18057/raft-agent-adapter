[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$nodePathFile = Join-Path $ProjectRoot '.local\node-path.txt'
$nodeExe = if (Test-Path -LiteralPath $nodePathFile) { (Get-Content -LiteralPath $nodePathFile -Raw).Trim() } else { (Get-Command node.exe -ErrorAction Stop).Source }
& $nodeExe (Join-Path $ProjectRoot 'scripts\refresh-models.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Could not refresh native model thinking options. Check Devin login and connectivity.' }
