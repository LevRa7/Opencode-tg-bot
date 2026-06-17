#!/usr/bin/env bash
# install-opencode-skills - Install OpenCode skills from a skills package to a target directory.
#
# Usage:
#   install-opencode-skills                              # default source -> default target
#   install-opencode-skills --source <pkg-dir> --target <skills-dir>
#
# Default source: /usr/local/lib/opencode-skills-pkg (baked into Docker image)
# Default target: /state/skills (Docker container skills path)
set -euo pipefail

SOURCE_DIR="${OPENCODE_SKILLS_PKG_DIR:-/usr/local/lib/opencode-skills-pkg}"
TARGET_DIR="${OPENCODE_SKILLS_TARGET:-/state/skills}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source|-s) SOURCE_DIR="$2"; shift 2 ;;
    --target|-t) TARGET_DIR="$2"; shift 2 ;;
    *) echo "Usage: $0 [--source <dir>] [--target <dir>]" >&2; exit 1 ;;
  esac
done

PKG_SKILLS="$SOURCE_DIR/skills"

if [ ! -d "$PKG_SKILLS" ]; then
  echo "Notice: skills package directory not found at $PKG_SKILLS — skipping bulk install (base skills already installed separately)" >&2
  exit 0
fi

mkdir -p "$TARGET_DIR"

INSTALLED=0

# 1. Install category/name/ skills (subdirectory-based)
for category_dir in "$PKG_SKILLS"/*/; do
  [ -d "$category_dir" ] || continue
  for skill_dir in "$category_dir"*/; do
    [ -d "$skill_dir" ] || continue
    skill_name="$(basename "$skill_dir")"
    if ! ls "$skill_dir"*.md >/dev/null 2>&1; then
      continue
    fi
    # Skip existing skills (don't overwrite customizations)
    if [ -d "$TARGET_DIR/$skill_name" ]; then
      continue
    fi
    mkdir -p "$TARGET_DIR/$skill_name"
    cp -R "$skill_dir/." "$TARGET_DIR/$skill_name/"
    INSTALLED=$((INSTALLED + 1))
  done
done

# 2. Install flat skills (category/*.md, not in a subdirectory)
for category_dir in "$PKG_SKILLS"/*/; do
  [ -d "$category_dir" ] || continue
  for md_file in "$category_dir"*.md; do
    [ -f "$md_file" ] || continue
    base="$(basename "$md_file" .md)"
    [ -d "$TARGET_DIR/$base" ] && continue
    mkdir -p "$TARGET_DIR/$base"
    cp "$md_file" "$TARGET_DIR/$base/opencode.md"
    INSTALLED=$((INSTALLED + 1))
  done
  # Copy companion scripts next to their skill directories
  for sh_file in "$category_dir"*.sh; do
    [ -f "$sh_file" ] || continue
    skill_name="$(basename "$sh_file" .sh)"
    if [ -d "$TARGET_DIR/$skill_name" ]; then
      cp "$sh_file" "$TARGET_DIR/$skill_name/"
    fi
  done
done

echo "Installed $INSTALLED skills to $TARGET_DIR"
