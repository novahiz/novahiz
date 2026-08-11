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

# 1. Détection des Environnements
echo -e "\n${YELLOW}🔍 Détection automatique de vos environnements IA...${NC}"

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

read -p "Entrez votre choix (1-6): " CHOICE

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

# 2. Exécution de l'Installation
for id in "${TARGETS[@]}"; do
    NAME="${HARNESS_NAMES[$id]}"
    DEST="${HARNESS_PATHS[$id]}"
    ADAPTER="${HARNESS_ADAPTERS[$id]}"

    echo -e "\n${CYAN}🚀 Installation de Novahiz dans : $NAME -> $DEST${NC}"
    mkdir -p "$DEST"

    # 2.1 Copie des Skills
    echo -e "${GRAY}  📦 Déploiement des 153 skills...${NC}"
    mkdir -p "$DEST/skills"
    cp -r "$SCRIPT_DIR/skills/"* "$DEST/skills/"

    # 2.2 Copie de l'inventaire
    mkdir -p "$DEST/skills_inventory"
    cp -r "$SCRIPT_DIR/skills_inventory/"* "$DEST/skills_inventory/"
    cp "$SCRIPT_DIR/skills_inventory.md" "$DEST/"

    # 2.3 Copie des MCPs
    mkdir -p "$DEST/mcp/servers"
    cp -r "$SCRIPT_DIR/mcp/servers/"* "$DEST/mcp/servers/"
    cp "$SCRIPT_DIR/mcp/mcp_config.example.json" "$DEST/mcp_config.json"

    # 2.4 Application de l'Adaptateur
    echo -e "${GRAY}  ⚙️ Application de l'adaptateur $ADAPTER...${NC}"
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

    # 2.5 Initialisation SQLite WAL
    if [ -f "$SCRIPT_DIR/reference_scripts/novahiz_migrate.py" ]; then
        python3 "$SCRIPT_DIR/reference_scripts/novahiz_migrate.py" || true
    fi

    echo -e "${GREEN}  ✅ Installation terminée pour $NAME !${NC}"
done

echo "=============================================================================="
echo -e "${GREEN}🎉 NOVAHIZ EST MAINTENANT OPÉRATIONNEL !${NC}"
echo "Votre assistant appliquera désormais automatiquement le Gate, le Sweeper et la Mémoire Dual-Write."
echo "=============================================================================="
