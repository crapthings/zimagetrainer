$ErrorActionPreference = 'Stop'

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath"
}

function Get-ToolPath {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$Candidates = @()
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    foreach ($candidate in $Candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Install-WingetPackage {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $winget = Get-ToolPath 'winget'
    if (-not $winget) {
        throw "Windows Package Manager (winget) is required to install $Label. Install App Installer from Microsoft Store, then run install.bat again."
    }

    Write-Host "Installing $Label..." -ForegroundColor Cyan
    & $winget install --exact --id $Id --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to install $Label (winget exit code $LASTEXITCODE)."
    }

    Refresh-Path
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host 'Preparing Z-Image Trainer. This may take a while on the first run.' -ForegroundColor Cyan

$uv = Get-ToolPath 'uv' @(
    (Join-Path $env:USERPROFILE '.local\bin\uv.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\uv\uv.exe')
)
if (-not $uv) {
    Install-WingetPackage 'astral-sh.uv' 'uv'
    $uv = Get-ToolPath 'uv' @(
        (Join-Path $env:USERPROFILE '.local\bin\uv.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\uv\uv.exe')
    )
}
if (-not $uv) {
    throw 'uv was installed but could not be found. Close this window, open install.bat again, and retry.'
}

$node = Get-ToolPath 'node' @((Join-Path $env:ProgramFiles 'nodejs\node.exe'))
if (-not $node) {
    Install-WingetPackage 'OpenJS.NodeJS.LTS' 'Node.js LTS'
    $node = Get-ToolPath 'node' @((Join-Path $env:ProgramFiles 'nodejs\node.exe'))
}
if (-not $node) {
    throw 'Node.js was installed but could not be found. Close this window, open install.bat again, and retry.'
}

$corepack = Get-ToolPath 'corepack' @((Join-Path $env:ProgramFiles 'nodejs\corepack.cmd'))
if (-not $corepack) {
    throw 'Corepack was not found with Node.js. Reinstall Node.js LTS, then run install.bat again.'
}

Write-Host 'Installing Python dependencies...' -ForegroundColor Cyan
& $uv sync --frozen
if ($LASTEXITCODE -ne 0) {
    throw "Python dependency installation failed (uv exit code $LASTEXITCODE)."
}

Write-Host 'Installing launcher dependencies...' -ForegroundColor Cyan
& $corepack pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) {
    throw "Launcher dependency installation failed (pnpm exit code $LASTEXITCODE)."
}

Write-Host 'Installing web dependencies...' -ForegroundColor Cyan
& $corepack pnpm --dir web install --frozen-lockfile
if ($LASTEXITCODE -ne 0) {
    throw "Web dependency installation failed (pnpm exit code $LASTEXITCODE)."
}

Write-Host 'All dependencies are ready.' -ForegroundColor Green
