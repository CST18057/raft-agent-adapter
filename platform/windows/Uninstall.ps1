[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$adapterBin = Join-Path $ProjectRoot 'bin'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$newPath = @($userPath -split ';' | Where-Object { $_ -and $_ -ine $adapterBin }) -join ';'
[Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
$env:Path = @($env:Path -split ';' | Where-Object { $_ -and $_ -ine $adapterBin }) -join ';'
Write-Output 'Removed this checkout from user PATH. Files, agent sessions and unrelated PATH entries are preserved.'
Write-Output 'Stop or switch agents that use this compatibility slot.'
