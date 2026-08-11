#!/usr/bin/env bash
# ==============================================================================
# ⚡ NOVAHIZ UNIVERSAL INSTALLER — BASH (MACOS / LINUX)
# ==============================================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GRAY='\033[0;90m'
NC='\033[0m'

echo -e "${CYAN}"
echo "   ███╗   ██╗ ██████╗ ██╗   ██╗ █████╗ ██╗  ██╗██╗███████╗"
echo "   ████╗  ██║██╔═══██╗██║   ██║██╔══██╗██║  ██║██║╚══███╔╝"
echo "   ██╔██╗ ██║██║   ██║██║   ██║███████║███████║██║  ███╔╝ "
echo "   ██║╚██╗██║██║   ██║╚██╗ ██╔╝██╔══██║██╔══██║██║ ███╔╝  "
echo "   ██║ ╚████║╚██████╔╝ ╚████╔╝ ██║  ██║██║  ██║██║███████╗"
echo "   ╚═╝  ╚═══╝ ╚═════╝   ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚══════╝"
echo -e "${GRAY}        Deterministic AI Agent Engine & Workflow Enforcer${NC}"
echo "=============================================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Détection des Assistants IA
echo -e "\n${YELLOW}🔍 [1/3] Détection automatique de vos environnements IA...${NC}"

declare -A HARNESS_NAMES
declare -A HARNESS_PATHS
declare -A HARNESS_DETECTED
declare -A HARNESS_ADAPTERS

HARNESS_NAMES[1]="Google Antigravity"
HARNESS_PATHS[1]="$HOME/.gemini/config"
[ -d "$HOME/.gemini" ] && HARNESS_DETECTED[1]=1 || HARNESS_DETECTED[1]=0
HARNESS_ADAPTERS[1]="antigravity"

HARNESS_NAMES[2]="Claude Code"
HARNESS_PATHS[2]="$HOME/.claude"
[ -d "$HOME/.claude" ] && HARNESS_DETECTED[2]=1 || HARNESS_DETECTED[2]=0
HARNESS_ADAPTERS[2]="claude-code"

HARNESS_NAMES[3]="OpenCode / Codex"
HARNESS_PATHS[3]="$HOME/.config/opencode"
[ -d "$HOME/.config/opencode" ] || [ -d "$HOME/.opencode" ] && HARNESS_DETECTED[3]=1 || HARNESS_DETECTED[3]=0
HARNESS_ADAPTERS[3]="opencode"

HARNESS_NAMES[4]="Cursor IDE"
HARNESS_PATHS[4]="$(pwd)"
[ -d "$HOME/.cursor" ] || [ -d "$(pwd)/.cursor" ] && HARNESS_DETECTED[4]=1 || HARNESS_DETECTED[4]=0
HARNESS_ADAPTERS[4]="cursor"

# Menu Interactif
echo -e "\n${GREEN}🎯 Veuillez choisir l'assistant IA dans lequel installer Novahiz :${NC}\n"

for i in 1 2 3 4; do
    if [ "${HARNESS_DETECTED[$i]}" -eq 1 ]; then
        echo -e "  [${i}] ${CYAN}${HARNESS_NAMES[$i]} [DÉTECTÉ]${NC}"
    else
        echo -e "  [${i}] ${GRAY}${HARNESS_NAMES[$i]} [Disponible]${NC}"
    fi
done

echo -e "  [5] \033[0;35m🌟 Installer dans TOUS les environnements détectés\033[0m"
echo -e "  [6] \033[0;33m📁 Choisir un répertoire personnalisé\033[0m"
echo -e "  [0] ${RED}❌ Quitter${NC}\n"

read -p "Entrez votre choix pour l'IA (1-6): " CHOICE

if [ "$CHOICE" == "0" ] || [ -z "$CHOICE" ]; then
    echo -e "${YELLOW}Installation annulée.${NC}"
    exit 0
fi

TARGETS=()

if [ "$CHOICE" == "5" ]; then
    for i in 1 2 3 4; do
        if [ "${HARNESS_DETECTED[$i]}" -eq 1 ]; then
            TARGETS+=($i)
        fi
    done
    if [ ${#TARGETS[@]} -eq 0 ]; then
        TARGETS=(1 2 3 4)
    fi
elif [ "$CHOICE" == "6" ]; then
    read -p "Entrez le chemin complet du répertoire cible: " CUSTOM_PATH
    if [ -d "$CUSTOM_PATH" ]; then
        HARNESS_NAMES[99]="Custom Directory"
        HARNESS_PATHS[99]="$CUSTOM_PATH"
        HARNESS_ADAPTERS[99]="antigravity"
        TARGETS=(99)
    else
        echo -e "${RED}Le répertoire spécifié n'existe pas.${NC}"
        exit 1
    fi
elif [ "$CHOICE" -ge 1 ] && [ "$CHOICE" -le 4 ]; then
    TARGETS=($CHOICE)
else
    echo -e "${RED}Option invalide.${NC}"
    exit 1
fi

# 2. Détection Automatique d'Obsidian et des Vaults
echo -e "\n${YELLOW}🔍 [2/3] Détection d'Obsidian et de vos coffres de notes...${NC}"

OBSIDIAN_CONFIG=""
if [ -f "$HOME/Library/Application Support/obsidian/obsidian.json" ]; then
    OBSIDIAN_CONFIG="$HOME/Library/Application Support/obsidian/obsidian.json"
elif [ -f "$HOME/.config/obsidian/obsidian.json" ]; then
    OBSIDIAN_CONFIG="$HOME/.config/obsidian/obsidian.json"
elif [ -f "$HOME/.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json" ]; then
    OBSIDIAN_CONFIG="$HOME/.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json"
fi

SELECTED_VAULT=""

if [ -n "$OBSIDIAN_CONFIG" ]; then
    echo -e "${CYAN}✨ Obsidian détecté ! Recherche des coffres existants...${NC}"
    # Parse vaults paths with Python if available
    VAULTS=$(python3 -c "
import json, sys
try:
    with open('$OBSIDIAN_CONFIG', 'r') as f:
        d = json.load(f)
        for v in d.get('vaults', {}).values():
            print(v.get('path', ''))
except: pass
" 2>/dev/null || true)

    if [ -n "$VAULTS" ]; then
        echo -e "Coffres trouvés :"
        INDEX=1
        declare -A VAULT_MAP
        while IFS= read -r line; do
            if [ -n "$line" ] && [ -d "$line" ]; then
                echo -e "  [${INDEX}] $line"
                VAULT_MAP[$INDEX]="$line"
                INDEX=$((INDEX + 1))
            fi
        done <<< "$VAULTS"

        if [ ${#VAULT_MAP[@]} -gt 0 ]; then
            echo -e "  [C] Entrer un autre chemin ou créer un nouveau coffre"
            read -p "Choisissez votre coffre (1-$((INDEX-1)) ou C): " V_CHOICE
            if [ -n "${VAULT_MAP[$V_CHOICE]}" ]; then
                SELECTED_VAULT="${VAULT_MAP[$V_CHOICE]}"
            fi
        fi
    fi
fi

if [ -z "$SELECTED_VAULT" ]; then
    DEFAULT_VAULT="$HOME/Documents/novahiz"
    read -p "Entrez le chemin de votre coffre Obsidian [Défaut: $DEFAULT_VAULT]: " USER_VAULT_INPUT
    if [ -z "$USER_VAULT_INPUT" ]; then
        SELECTED_VAULT="$DEFAULT_VAULT"
    else
        SELECTED_VAULT="$USER_VAULT_INPUT"
    fi
fi

mkdir -p "$SELECTED_VAULT/Novahiz-Sessions"
echo -e "${GREEN}  📌 Coffre Obsidian configuré : $SELECTED_VAULT${NC}"

# 3. Déploiement des Composants
echo -e "\n${YELLOW}🚀 [3/3] Déploiement des composants Novahiz...${NC}"

for id in "${TARGETS[@]}"; do
    NAME="${HARNESS_NAMES[$id]}"
    DEST="${HARNESS_PATHS[$id]}"
    ADAPTER="${HARNESS_ADAPTERS[$id]}"

    echo -e "\n${CYAN}📦 Configuration pour : $NAME ($DEST)${NC}"
    mkdir -p "$DEST"

    # 3.1 Copie des Skills
    mkdir -p "$DEST/skills"
    cp -r "$SCRIPT_DIR/skills/"* "$DEST/skills/"

    # 3.2 Copie de l'inventaire
    mkdir -p "$DEST/skills_inventory"
    cp -r "$SCRIPT_DIR/skills_inventory/"* "$DEST/skills_inventory/"
    cp "$SCRIPT_DIR/skills_inventory.md" "$DEST/"

    # 3.3 Configuration MCP avec le Vault dynamique
    mkdir -p "$DEST/mcp/servers"
    cp -r "$SCRIPT_DIR/mcp/servers/"* "$DEST/mcp/servers/"

    cat <<EOF > "$DEST/mcp_config.json"
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
      "args": ["-y", "mcpvault", "$SELECTED_VAULT"]
    },
    "novahiz-tools": {
      "command": "node",
      "args": ["$DEST/mcp/servers/novahiz-tools/index.js"]
    }
  }
}
EOF

    # 3.4 Configuration globale
    cat <<EOF > "$DEST/config.json"
{
  "obsidianVaultPath": "$SELECTED_VAULT",
  "version": "1.0.0",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

    # 3.5 Application de l'Adaptateur
    if [ "$ADAPTER" == "antigravity" ]; then
        mkdir -p "$DEST/plugins/novahiz"
        cp -r "$SCRIPT_DIR/adapters/antigravity/novahiz-plugin/"* "$DEST/plugins/novahiz/"
    elif [ "$ADAPTER" == "claude-code" ]; then
        cp "$SCRIPT_DIR/adapters/claude-code/CLAUDE.md" "$DEST/"
    elif [ "$ADAPTER" == "cursor" ]; then
        cp "$SCRIPT_DIR/adapters/cursor/.cursorrules" "$DEST/"
    elif [ "$ADAPTER" == "opencode" ]; then
        cp "$SCRIPT_DIR/adapters/opencode/opencode.json" "$DEST/"
    fi

    # 3.6 Initialisation SQLite WAL
    if [ -f "$SCRIPT_DIR/reference_scripts/novahiz_migrate.py" ]; then
        python3 "$SCRIPT_DIR/reference_scripts/novahiz_migrate.py" || true
    fi

    echo -e "${GREEN}  ✅ Installation réussie pour $NAME !${NC}"
done

echo "=============================================================================="
echo -e "${GREEN}🎉 NOVAHIZ EST MAINTENANT CONFIGURÉ AVEC SUCCÈS !${NC}"
echo "  - Coffre Obsidian: $SELECTED_VAULT"
echo "=============================================================================="
