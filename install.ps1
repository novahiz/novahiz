# ==============================================================================
# ⚡ NOVAHIZ UNIVERSAL INSTALLER — POWERSHELL (WINDOWS)
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

function Print-Banner {
    Write-Host ""
    Write-Host "   ███╗   ██╗ ██████╗ ██╗   ██╗ █████╗ ██╗  ██╗██╗███████╗" -ForegroundColor Cyan
    Write-Host "   ████╗  ██║██╔═══██╗██║   ██║██╔══██╗██║  ██║██║╚══███╔╝" -ForegroundColor Cyan
    Write-Host "   ██╔██╗ ██║██║   ██║██║   ██║███████║███████║██║  ███╔╝ " -ForegroundColor Cyan
    Write-Host "   ██║╚██╗██║██║   ██║╚██╗ ██╔╝██╔══██║██╔══██║██║ ███╔╝  " -ForegroundColor Cyan
    Write-Host "   ██║ ╚████║╚██████╔╝ ╚████╔╝ ██║  ██║██║  ██║██║███████╗" -ForegroundColor Cyan
    Write-Host "   ╚═╝  ╚═══╝ ╚═════╝   ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚══════╝" -ForegroundColor Cyan
    Write-Host "        Deterministic AI Agent Engine & Workflow Enforcer" -ForegroundColor DarkGray
    Write-Host "==============================================================================" -ForegroundColor DarkCyan
}

Print-Banner

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir) { $ScriptDir = Get-Location }

# 1. Détection des Assistants IA installés
Write-Host "`n🔍 [1/3] Détection automatique de vos environnements IA..." -ForegroundColor Yellow

$Harnesses = @()

# Antigravity
$AntigravityPath = Join-Path $HOME ".gemini\config"
$AntigravityDetected = Test-Path (Join-Path $HOME ".gemini")
$Harnesses += [PSCustomObject]@{
    Id = "1"; Name = "Google Antigravity"; Path = $AntigravityPath; Detected = $AntigravityDetected; Adapter = "antigravity"
}

# Claude Code
$ClaudePath = Join-Path $HOME ".claude"
$ClaudeDetected = Test-Path $ClaudePath
$Harnesses += [PSCustomObject]@{
    Id = "2"; Name = "Claude Code"; Path = $ClaudePath; Detected = $ClaudeDetected; Adapter = "claude-code"
}

# OpenCode / Codex
$OpenCodePath = Join-Path $HOME ".config\opencode"
$OpenCodeDetected = (Test-Path $OpenCodePath) -or (Test-Path (Join-Path $HOME ".opencode"))
$Harnesses += [PSCustomObject]@{
    Id = "3"; Name = "OpenCode / Codex"; Path = $OpenCodePath; Detected = $OpenCodeDetected; Adapter = "opencode"
}

# Cursor IDE
$CursorPath = Join-Path $HOME ".cursor"
$CursorDetected = (Test-Path $CursorPath) -or (Test-Path (Join-Path (Get-Location) ".cursor"))
$Harnesses += [PSCustomObject]@{
    Id = "4"; Name = "Cursor IDE (.cursorrules)"; Path = (Get-Location); Detected = $CursorDetected; Adapter = "cursor"
}

# Menu de Sélection de l'IA
Write-Host "`n🎯 Veuillez choisir l'assistant IA dans lequel installer Novahiz :`n" -ForegroundColor Green

foreach ($h in $Harnesses) {
    $tag = if ($h.Detected) { "[DÉTECTÉ]" } else { "[Disponible]" }
    $color = if ($h.Detected) { "Cyan" } else { "Gray" }
    Write-Host "  [$($h.Id)] $($h.Name.PadRight(25)) $tag" -ForegroundColor $color
}
Write-Host "  [5] 🌟 Installer dans TOUS les environnements détectés" -ForegroundColor Magenta
Write-Host "  [6] 📁 Choisir un répertoire personnalisé" -ForegroundColor DarkYellow
Write-Host "  [0] ❌ Quitter`n" -ForegroundColor Red

$Choice = Read-Host "Entrez votre choix pour l'IA (1-6)"

if ($Choice -eq "0" -or [string]::IsNullOrWhiteSpace($Choice)) {
    Write-Host "Installation annulée." -ForegroundColor Yellow
    exit 0
}

$SelectedTargets = @()

if ($Choice -eq "5") {
    $SelectedTargets = $Harnesses | Where-Object { $_.Detected }
    if ($SelectedTargets.Count -eq 0) { $SelectedTargets = $Harnesses }
} elseif ($Choice -eq "6") {
    $CustomPath = Read-Host "Entrez le chemin complet du répertoire cible"
    if (Test-Path $CustomPath) {
        $SelectedTargets += [PSCustomObject]@{
            Id = "Custom"; Name = "Custom Directory"; Path = $CustomPath; Detected = $true; Adapter = "antigravity"
        }
    } else {
        Write-Host "Le répertoire spécifié n'existe pas." -ForegroundColor Red
        exit 1
    }
} else {
    $Target = $Harnesses | Where-Object { $_.Id -eq $Choice }
    if ($Target) {
        $SelectedTargets += $Target
    } else {
        Write-Host "Option invalide." -ForegroundColor Red
        exit 1
    }
}

# 2. Détection Automatique d'Obsidian et des Coffres (Vaults)
Write-Host "`n🔍 [2/3] Détection d'Obsidian et de vos coffres de notes..." -ForegroundColor Yellow

$ObsidianConfigFile = Join-Path $env:APPDATA "obsidian\obsidian.json"
$DiscoveredVaults = @()

if (Test-Path $ObsidianConfigFile) {
    try {
        $obsJson = Get-Content $ObsidianConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($obsJson.vaults) {
            foreach ($prop in $obsJson.vaults.PSObject.Properties) {
                $vPath = $prop.Value.path
                if ($vPath -and (Test-Path $vPath)) {
                    $DiscoveredVaults += $vPath
                }
            }
        }
    } catch {}
}

$SelectedVaultPath = ""

if ($DiscoveredVaults.Count -gt 0) {
    Write-Host "✨ Obsidian est installé sur votre système ! Coffres découverts :" -ForegroundColor Cyan
    for ($i = 0; $i -lt $DiscoveredVaults.Count; $i++) {
        Write-Host "  [$($i+1)] $($DiscoveredVaults[$i])" -ForegroundColor White
    }
    Write-Host "  [C] Entrer un autre chemin ou créer un nouveau coffre" -ForegroundColor DarkYellow
    
    $vChoice = Read-Host "`nChoisissez votre coffre pour la mémoire Novahiz (1-$($DiscoveredVaults.Count) ou C)"
    if ($vChoice -match "^\d+$" -and [int]$vChoice -ge 1 -and [int]$vChoice -le $DiscoveredVaults.Count) {
        $SelectedVaultPath = $DiscoveredVaults[[int]$vChoice - 1]
    }
}

if ([string]::IsNullOrWhiteSpace($SelectedVaultPath)) {
    $DefaultVault = Join-Path $HOME "Documents\novahiz"
    $userVaultInput = Read-Host "Entrez le chemin complet de votre coffre Obsidian [Défaut: $DefaultVault]"
    if ([string]::IsNullOrWhiteSpace($userVaultInput)) {
        $SelectedVaultPath = $DefaultVault
    } else {
        $SelectedVaultPath = $userVaultInput
    }
}

# Création du dossier du vault s'il n'existe pas
if (-not (Test-Path $SelectedVaultPath)) {
    New-Item -Path $SelectedVaultPath -ItemType Directory -Force | Out-Null
    Write-Host "  📁 Création du nouveau coffre : $SelectedVaultPath" -ForegroundColor DarkGray
}

$SessionsSubfolder = Join-Path $SelectedVaultPath "Novahiz-Sessions"
if (-not (Test-Path $SessionsSubfolder)) {
    New-Item -Path $SessionsSubfolder -ItemType Directory -Force | Out-Null
}

Write-Host "  📌 Coffre Obsidian configuré : $SelectedVaultPath" -ForegroundColor Green

# 3. Déploiement et Configuration dans chaque IA Cible
Write-Host "`n🚀 [3/3] Déploiement des composants Novahiz..." -ForegroundColor Yellow

foreach ($target in $SelectedTargets) {
    Write-Host "`n📦 Configuration pour : $($target.Name) ($($target.Path))" -ForegroundColor Cyan
    
    $TargetDir = $target.Path
    New-Item -Path $TargetDir -ItemType Directory -Force | Out-Null
    
    # 3.1 Copie des Skills et de l'Inventaire
    $SkillsTarget = Join-Path $TargetDir "skills"
    Copy-Item -Path (Join-Path $ScriptDir "skills\*") -Destination $SkillsTarget -Recurse -Force | Out-Null
    
    $InvTarget = Join-Path $TargetDir "skills_inventory"
    Copy-Item -Path (Join-Path $ScriptDir "skills_inventory\*") -Destination $InvTarget -Recurse -Force | Out-Null
    Copy-Item -Path (Join-Path $ScriptDir "skills_inventory.md") -Destination $TargetDir -Force | Out-Null
    
    # 3.2 Configuration MCP avec le Vault Obsidian dynamique
    $McpTarget = Join-Path $TargetDir "mcp"
    New-Item -Path $McpTarget -ItemType Directory -Force | Out-Null
    Copy-Item -Path (Join-Path $ScriptDir "mcp\servers\*") -Destination (Join-Path $McpTarget "servers") -Recurse -Force | Out-Null
    
    # Création du mcp_config.json avec le bon chemin de vault
    $EscapedVault = $SelectedVaultPath -replace '\\', '\\'
    $NovahizToolsPath = (Join-Path $TargetDir "mcp\servers\novahiz-tools\index.js") -replace '\\', '\\'
    
    $McpJson = @"
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--browserUrl=http://127.0.0.1:9222", "--no-usage-statistics", "--no-performance-crux", "--screenshotFormat=png"]
    },
    "cron": {
      "command": "npx",
      "args": ["-y", "mcp-cron"]
    },
    "git": {
      "command": "npx",
      "args": ["-y", "git-mcp-server"]
    },
    "obsidian": {
      "command": "npx",
      "args": ["-y", "mcpvault", "$EscapedVault"]
    },
    "novahiz-tools": {
      "command": "node",
      "args": ["$NovahizToolsPath"]
    }
  }
}
"@
    Set-Content -Path (Join-Path $TargetDir "mcp_config.json") -Value $McpJson -Encoding UTF8
    
    # 3.3 Sauvegarde du config.json global avec le chemin du Vault
    $ConfigJson = @"
{
  "obsidianVaultPath": "$EscapedVault",
  "version": "1.0.0",
  "installedAt": "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')"
}
"@
    Set-Content -Path (Join-Path $TargetDir "config.json") -Value $ConfigJson -Encoding UTF8
    
    # 3.4 Application de l'Adaptateur
    if ($target.Adapter -eq "antigravity") {
        $PluginsTarget = Join-Path $TargetDir "plugins\novahiz"
        New-Item -Path $PluginsTarget -ItemType Directory -Force | Out-Null
        Copy-Item -Path (Join-Path $ScriptDir "adapters\antigravity\novahiz-plugin\*") -Destination $PluginsTarget -Recurse -Force | Out-Null
    } elseif ($target.Adapter -eq "claude-code") {
        Copy-Item -Path (Join-Path $ScriptDir "adapters\claude-code\CLAUDE.md") -Destination $TargetDir -Force | Out-Null
    } elseif ($target.Adapter -eq "cursor") {
        Copy-Item -Path (Join-Path $ScriptDir "adapters\cursor\.cursorrules") -Destination $TargetDir -Force | Out-Null
    } elseif ($target.Adapter -eq "opencode") {
        Copy-Item -Path (Join-Path $ScriptDir "adapters\opencode\opencode.json") -Destination (Join-Path $TargetDir "opencode.json") -Force | Out-Null
    }
    
    # 3.5 Initialisation SQLite WAL
    $MigrateScript = Join-Path $ScriptDir "reference_scripts\novahiz_migrate.py"
    if (Test-Path $MigrateScript) {
        python $MigrateScript
    }
    
    Write-Host "  ✅ Installation réussie pour $($target.Name) !" -ForegroundColor Green
}

Write-Host "`n==============================================================================" -ForegroundColor DarkCyan
Write-Host "🎉 NOVAHIZ EST MAINTENANT CONFIGURÉ AVEC SUCCÈS !" -ForegroundColor Green
Write-Host "  - Environnements : $($SelectedTargets.Name -join ', ')" -ForegroundColor White
Write-Host "  - Coffre Obsidian: $SelectedVaultPath" -ForegroundColor White
Write-Host "==============================================================================" -ForegroundColor DarkCyan
