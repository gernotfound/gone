$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$NodeVersion = '22.23.2'
$RuntimeRoot = Join-Path $PSScriptRoot '.gone-runtime'
$ForceLocal = $env:GONE_FORCE_LOCAL_NODE -eq '1'
$BootstrapOnly = $env:GONE_BOOTSTRAP_ONLY -eq '1'
$NoPause = $env:GONE_NO_PAUSE -eq '1'

function Get-SystemNodeMajor {
    try {
        $node = Get-Command node -ErrorAction Stop
        $npm = Get-Command npm -ErrorAction Stop
        $major = [int](& $node.Source -p "process.versions.node.split('.')[0]")
        if ($major -ge 22) {
            return @{ Node = $node.Source; Npm = $npm.Source; Major = $major }
        }
    } catch {
        return $null
    }
    return $null
}

function Get-LocalNode {
    $machine = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $arch = if ($machine -match 'ARM64') { 'arm64' } else { 'x64' }
    $archiveName = "node-v$NodeVersion-win-$arch.zip"
    $nodeDir = Join-Path $RuntimeRoot "node-v$NodeVersion-win-$arch"
    $nodeExe = Join-Path $nodeDir 'node.exe'
    $npmCmd = Join-Path $nodeDir 'npm.cmd'

    if (-not (Test-Path $nodeExe) -or -not (Test-Path $npmCmd)) {
        New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
        $archivePath = Join-Path $RuntimeRoot $archiveName
        $url = "https://nodejs.org/dist/v$NodeVersion/$archiveName"
        Write-Host "[G.O.N.E.] Node.js non presente: scarico runtime locale $NodeVersion ($arch)..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $url -OutFile $archivePath -UseBasicParsing
        if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
        Expand-Archive -Path $archivePath -DestinationPath $RuntimeRoot -Force
        Remove-Item -Force $archivePath
    }

    return @{ Node = $nodeExe; Npm = $npmCmd; Major = 22 }
}

try {
    $runtime = $null
    if (-not $ForceLocal) { $runtime = Get-SystemNodeMajor }
    if ($null -eq $runtime) { $runtime = Get-LocalNode }

    $node = $runtime.Node
    $npm = $runtime.Npm
    Write-Host "[G.O.N.E.] Runtime Node pronto: $(& $node --version)"

    Write-Host '[G.O.N.E.] Preparazione client web...'
    & $npm ci --prefix game-web
    if ($LASTEXITCODE -ne 0) { throw "npm ci game-web fallito ($LASTEXITCODE)" }
    & $npm run build --prefix game-web
    if ($LASTEXITCODE -ne 0) { throw "build game-web fallita ($LASTEXITCODE)" }

    Write-Host '[G.O.N.E.] Preparazione host locale...'
    Push-Location (Join-Path $PSScriptRoot 'gone-host')
    try {
        & $npm install --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw "install gone-host fallita ($LASTEXITCODE)" }
    } finally {
        Pop-Location
    }

    if ($BootstrapOnly) {
        Write-Host '[G.O.N.E.] Bootstrap completato.'
        exit 0
    }

    Write-Host '[G.O.N.E.] Avvio server sul tuo PC...'
    & $node gone-host/server.mjs
    exit $LASTEXITCODE
} catch {
    Write-Host ''
    Write-Host ('[G.O.N.E.] Avvio fallito: ' + $_.Exception.Message) -ForegroundColor Red
    if (-not $NoPause) {
        Write-Host 'Premi INVIO per chiudere.'
        [void](Read-Host)
    }
    exit 1
}
