[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$nodeExe = (& $nodeCommand.Source -p "require('node:fs').realpathSync(process.execPath)").Trim()
$nodeMajor = [int](& $nodeExe -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) { throw 'Node.js 22 or newer is required.' }
$compilerCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $compiler) { throw '.NET Framework 4 C# compiler not found. Enable/install .NET Framework 4.x first.' }
New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot 'bin'),(Join-Path $PSScriptRoot '.local') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $PSScriptRoot '.local\node-path.txt'), $nodeExe, (New-Object Text.UTF8Encoding($false)))
& $compiler /nologo /target:exe /optimize+ ("/out:{0}" -f (Join-Path $PSScriptRoot 'bin\grok.exe')) (Join-Path $PSScriptRoot 'scripts\Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed. Stop agents using this checkout before rebuilding an in-use launcher.' }
& (Join-Path $PSScriptRoot 'bin\grok.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'Launcher version check failed.' }
