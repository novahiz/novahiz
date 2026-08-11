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

# 1. Détection de l'Environnement et des IA installées
Write-Host "`n🔍 Détection automatique de vos environnements IA..." -ForegroundColor Yellow

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

# Menu Interactif
Write-Host "`n🎯 Veuillez choisir l'assistant IA dans lequel installer Novahiz :`n" -ForegroundColor Green

foreach ($h in $Harnesses) {
    $tag = if ($h.Detected) { "[DÉTECTÉ]" } else { "[Disponible]" }
    $color = if ($h.Detected) { "Cyan" } else { "Gray" }
    Write-Host "  [$($h.Id)] $($h.Name.PadRight(25)) $tag" -ForegroundColor $color
}
Write-Host "  [5] 🌟 Installer dans TOUS les environnements détectés" -ForegroundColor Magenta
Write-Host "  [6] 📁 Choisir un répertoire personnalisé" -ForegroundColor DarkYellow
Write-Host "  [0] ❌ Quitter`n" -ForegroundColor Red

$Choice = Read-Host "Entrez votre choix (1-6)"

if ($Choice -eq "0" -or [string]::IsNullOrWhiteSpace($Choice)) {
    Write-Host "Installation annulée." -ForegroundColor Yellow
    exit 0
}

$SelectedTargets = @()

if ($Choice -eq "5") {
    $SelectedTargets = $Harnesses | Where-Object { $_.Detected }
    if ($SelectedTargets.Count -eq 0) {
        $SelectedTargets = $Harnesses
    }
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

# 2. Exécution de l'Installation
foreach ($target in $SelectedTargets) {
    Write-Host "`n🚀 Installation de Novahiz dans : $($target.Name) -> $($target.Path)" -ForegroundColor Cyan
    
    $TargetDir = $target.Path
    New-Item -Path $TargetDir -ItemType Directory -Force | Out-Null
    
    # 2.1 Copie des Skills
    $SkillsTarget = Join-Path $TargetDir "skills"
    Write-Host "  📦 Déploiement des 153 skills..." -ForegroundColor DarkGray
    Copy-Item -Path (Join-Path $ScriptDir "skills\*") -Destination $SkillsTarget -Recurse -Force | Out-Null
    
    # 2.2 Copie de l'inventaire
    $InvTarget = Join-Path $TargetDir "skills_inventory"
    Copy-Item -Path (Join-Path $ScriptDir "skills_inventory\*") -Destination $InvTarget -Recurse -Force | Out-Null
    Copy-Item -Path (Join-Path $ScriptDir "skills_inventory.md") -Destination $TargetDir -Force | Out-Null
    
    # 2.3 Copie des MCPs
    $McpTarget = Join-Path $TargetDir "mcp"
    New-Item -Path $McpTarget -ItemType Directory -Force | Out-Null
    Copy-Item -Path (Join-Path $ScriptDir "mcp\servers\*") -Destination (Join-Path $McpTarget "servers") -Recurse -Force | Out-Null
    Copy-Item -Path (Join-Path $ScriptDir "mcp\mcp_config.example.json") -Destination (Join-Path $TargetDir "mcp_config.json") -Force | Out-Null
    
    # 2.4 Application de l'Adaptateur
    Write-Host "  ⚙️ Application de l'adaptateur $($target.Adapter)..." -ForegroundColor DarkGray
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
    
    # 2.5 Initialisation SQLite WAL
    Write-Host "  🗄️ Initialisation de la base SQLite WAL..." -ForegroundColor DarkGray
    $DbPath = Join-Path $TargetDir "novahiz.db"
    $MigrateScript = Join-Path $ScriptDir "reference_scripts\novahiz_migrate.py"
    if (Test-Path $MigrateScript) {
        python $MigrateScript
    }
    
    Write-Host "  ✅ Installation terminée pour $($target.Name) !" -ForegroundColor Green
}

Write-Host "`n==============================================================================" -ForegroundColor DarkCyan
Write-Host "🎉 NOVAHIZ EST MAINTENANT OPÉRATIONNEL !" -ForegroundColor Green
Write-Host "Votre assistant appliquera désormais automatiquement le Gate, le Sweeper et la Mémoire Dual-Write." -ForegroundColor White
Write-Host "==============================================================================" -ForegroundColor DarkCyan
