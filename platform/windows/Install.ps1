[CmdletBinding()]
param([string]$DevinExe, [string]$ProxyUrl, [switch]$ReplaceAdapter)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
& (Join-Path $PSScriptRoot 'Build.ps1')
$adapterBin = Join-Path $ProjectRoot 'bin'
$adapterExe = Join-Path $adapterBin 'grok.exe'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @($userPath -split ';' | Where-Object { $_ })
$previous = @()
# Check both the current shell and persisted user PATH; shells may be stale.
$possible = @((Get-Command grok.exe -ErrorAction SilentlyContinue).Source)
$possible += @($entries | ForEach-Object { Join-Path $_ 'grok.exe' } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
foreach ($existing in @($possible | Where-Object { $_ } | Select-Object -Unique)) {
    if ([IO.Path]::GetFullPath($existing) -ieq $adapterExe) { continue }
    if (-not $ReplaceAdapter) { throw 'Another grok.exe exists. A real Grok installation cannot share this slot. Use -ReplaceAdapter only to migrate an older checkout of this adapter.' }
    $identity = (& $existing --version 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or $identity -notlike 'raft-agent-adapter *') { throw 'Refusing to replace an executable that does not identify as raft-agent-adapter.' }
    $previous += Split-Path -Parent $existing
}
$configPath = Join-Path $ProjectRoot 'adapter.config.json'
if ($PSBoundParameters.ContainsKey('DevinExe') -or $PSBoundParameters.ContainsKey('ProxyUrl')) {
    $config = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
    if ($PSBoundParameters.ContainsKey('DevinExe')) {
        if (-not (Test-Path -LiteralPath $DevinExe -PathType Leaf)) { throw 'DevinExe does not exist.' }
        $config | Add-Member NoteProperty devinExe ([IO.Path]::GetFullPath($DevinExe)) -Force
    }
    if ($PSBoundParameters.ContainsKey('ProxyUrl')) { $config | Add-Member NoteProperty proxyUrl $ProxyUrl -Force }
    $config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
}
$statePath = Join-Path $ProjectRoot '.local\installation-state.json'
if (-not (Test-Path -LiteralPath $statePath)) {
    [pscustomobject]@{ installedAt = [DateTimeOffset]::Now.ToString('o'); pathBeforeInstall = $userPath; adapterBin = $adapterBin; previousAdapterBins = $previous } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}
$entries = @($entries | Where-Object { $_ -notin $previous -and $_ -ine $adapterBin })
[Environment]::SetEnvironmentVariable('Path', (($entries + $adapterBin) -join ';'), 'User')
$env:Path = $adapterBin + ';' + (@($env:Path -split ';' | Where-Object { $_ -notin $previous -and $_ -ine $adapterBin }) -join ';')
Write-Output 'Installed the adapter in this Windows user PATH. Run Refresh-Models.ps1, then refresh the Model list in Raft.'
Write-Output 'If Grok Build is absent from the Computer inventory, restart that Computer through its usual startup method. Existing agents will briefly restart.'
