#!/usr/bin/env bash
# OpenCode Skills Installer
# Install individual skills or categories with all dependencies
set -euo pipefail

SKILLS_DIR="$(cd "$(dirname "$0")" && pwd)"
CATALOG="$SKILLS_DIR/registry/catalog.json"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

usage() {
  echo "OpenCode Skills Installer"
  echo ""
  echo "Usage:"
  echo "  bash install.sh                    — list all available skills"
  echo "  bash install.sh <category>/<skill> — install one skill"
  echo "  bash install.sh list               — list all skills"
  echo "  bash install.sh info <skill>       — show skill details"
  echo ""
  echo "Examples:"
  echo "  bash install.sh security/web-pentest"
  echo "  bash install.sh mlops/chroma"
  echo "  bash install.sh visual/screen-manager"
}

list_skills() {
  echo -e "${CYAN}Available skills:${NC}"
  python3 -c "
import json
with open('$CATALOG') as f:
    c = json.load(f)
for cat, data in sorted(c['categories'].items()):
    if data['skills']:
        print(f\"\n  ${YELLOW}{cat}${NC}:\")
        for name, info in sorted(data['skills'].items()):
            print(f\"    · ${GREEN}{cat}/{name}${NC} — {info['description']}\")
  "
}

show_info() {
  python3 -c "
import json, sys
with open('$CATALOG') as f:
    c = json.load(f)
target = sys.argv[1]
for cat, data in c['categories'].items():
    for name, info in data['skills'].items():
        if f'{cat}/{name}' == target or name == target:
            print(f\"Name:        ${GREEN}{name}${NC}\")
            print(f\"Category:    ${YELLOW}{cat}${NC}\")
            print(f\"Description: {info['description']}\")
            if info['dependencies']:
                print(f\"Deps:        {', '.join(info['dependencies'])}\")
            if info['env_vars']:
                print(f\"Env vars:    {', '.join(info['env_vars'])}\")
            if info['setup']:
                print(f\"Setup:       {info['setup']}\")
            sys.exit(0)
print(f\"${RED}Skill not found: {target}${NC}\")
sys.exit(1)
  "
}

install_skill() {
  local target="$1"
  local category="${target%%/*}"
  local name="${target##*/}"

  echo -e "${CYAN}=== Installing: $category/$name ===${NC}"

  # Resolve deps from catalog
  DEPS=$(python3 -c "
import json, sys
with open('$CATALOG') as f:
    c = json.load(f)
for cat, data in c['categories'].items():
    for n, info in data['skills'].items():
        if f'{cat}/{n}' == sys.argv[1]:
            print(json.dumps(info))
            sys.exit(0)
print('{}')
  " "$target")

  if [ "$DEPS" = "{}" ]; then
    echo -e "${RED}Skill not found${NC}"
    exit 1
  fi

  APT_DEPS=$(echo "$DEPS" | python3 -c "import json,sys; deps=json.load(sys.stdin)['dependencies']; print(' '.join(d for d in deps if d and not d.startswith('pip:') and not d.startswith('npm:')))")
  PIP_DEPS=$(echo "$DEPS" | python3 -c "import json,sys; deps=json.load(sys.stdin)['dependencies']; print(' '.join(d.replace('pip:','') for d in deps if d.startswith('pip:')))")
  NPM_DEPS=$(echo "$DEPS" | python3 -c "import json,sys; deps=json.load(sys.stdin)['dependencies']; print(' '.join(d.replace('npm:','') for d in deps if d.startswith('npm:')))")

  # Install system deps
  if [ -n "$APT_DEPS" ]; then
    echo -e "${YELLOW}[apt]${NC} $APT_DEPS"
    if command -v apt-get &>/dev/null; then
      apt-get update -qq && apt-get install -y -qq $APT_DEPS 2>/dev/null || true
    fi
  fi

  # Install pip deps
  if [ -n "$PIP_DEPS" ]; then
    echo -e "${YELLOW}[pip]${NC} $PIP_DEPS"
    pip3 install $PIP_DEPS 2>/dev/null || true
  fi

  # Install npm deps
  if [ -n "$NPM_DEPS" ]; then
    echo -e "${YELLOW}[npm]${NC} $NPM_DEPS"
    npm install -g $NPM_DEPS 2>/dev/null || true
  fi

  # Show env vars needed
  ENV_VARS=$(echo "$DEPS" | python3 -c "import json,sys; print('\n'.join(json.load(sys.stdin)['env_vars']))")
  if [ -n "$ENV_VARS" ]; then
    echo -e "${YELLOW}Required env vars:${NC}"
    echo "$ENV_VARS" | while read var; do
      echo "  export $var=<your-value>"
    done
  fi

  # Copy skill instructions
  SKILL_FILE="$SKILLS_DIR/skills/$category/$name/opencode.md"
  if [ -f "$SKILL_FILE" ]; then
    SKILL_TARGET="${OPENCODE_HOME:-$HOME/.config/opencode}/skills/$name"
    mkdir -p "$(dirname "$SKILL_TARGET")"
    cp "$SKILL_FILE" "$SKILL_TARGET.md"
    echo -e "${GREEN}Skill instructions → $SKILL_TARGET.md${NC}"
  fi

  # Run custom setup
  SETUP=$(echo "$DEPS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('setup',''))")
  if [ -n "$SETUP" ]; then
    echo -e "${YELLOW}Setup:${NC} $SETUP"
  fi

  echo -e "${GREEN}✓ $target installed${NC}"
}

case "${1:-}" in
  list|--list|-l)
    list_skills
    ;;
  info|--info|-i)
    shift
    show_info "$1"
    ;;
  --help|-h|"")
    usage
    list_skills
    ;;
  *)
    install_skill "$1"
    ;;
esac
