#!/usr/bin/env bash
set -euo pipefail

export BUN_INSTALL="${BUN_INSTALL:-/root/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

PROJECT_DIR="${PROJECT_DIR:-/opt/OpenclawHomework}"
IMPORT_ROOT="${GBRAIN_IMPORT_ROOT:-/opt/gbrain-import}"

require_gbrain() {
  if ! command -v gbrain >/dev/null 2>&1; then
    echo "gbrain command not found. Install it on Hermes first." >&2
    exit 1
  fi
}

copy_markdown_docs() {
  local target="$IMPORT_ROOT/openclaw-homework-docs"
  rm -rf "$target"
  mkdir -p "$target"
  cd "$PROJECT_DIR"
  find docs -type f -name '*.md' -print0 | while IFS= read -r -d '' file; do
    mkdir -p "$target/$(dirname "$file")"
    cp "$file" "$target/$file"
  done
}

copy_memory() {
  local target="$IMPORT_ROOT/openclaw-homework-memory"
  rm -rf "$target"
  mkdir -p "$target"
  cd "$PROJECT_DIR"
  if [ -d data/memory ]; then
    find data/memory -type f \( -name '*.md' -o -name '*.json' \) -print0 | while IFS= read -r -d '' file; do
      mkdir -p "$target/$(dirname "$file")"
      cp "$file" "$target/$file"
    done
  fi
  find "$target" -type f -name '*.json' -print0 | while IFS= read -r -d '' file; do
    local markdown="${file%.json}.md"
    {
      printf '# %s\n\n```json\n' "$(basename "$file" .json)"
      cat "$file"
      printf '\n```\n'
    } > "$markdown"
    rm -f "$file"
  done
}

copy_qa_assets() {
  local target="$IMPORT_ROOT/openclaw-homework-qa"
  rm -rf "$target"
  mkdir -p "$target"
  cd "$PROJECT_DIR"
  if [ -d data/qa-assets ]; then
    find data/qa-assets -type f -name '*.json' -print0 | while IFS= read -r -d '' file; do
      local markdown="$target/${file%.json}.md"
      mkdir -p "$(dirname "$markdown")"
      {
        printf '# %s\n\n```json\n' "$(basename "$file" .json)"
        cat "$file"
        printf '\n```\n'
      } > "$markdown"
    done
  fi
}

ensure_git_repo() {
  local repo="$1"
  cd "$repo"
  rm -rf .git
  git init -q
  git config user.email gbrain@localhost
  git config user.name GBrainImport
  git remote add origin "$repo" 2>/dev/null || true
  git add .
  git commit -q -m 'sync openclaw homework knowledge' || true
}

ensure_source() {
  local id="$1"
  local path="$2"
  gbrain sources add "$id" --path "$path" >/dev/null 2>&1 || true
}

sync_source() {
  local id="$1"
  gbrain sync --source "$id" --no-embed
}

main() {
  require_gbrain
  copy_markdown_docs
  copy_memory
  copy_qa_assets

  ensure_git_repo "$IMPORT_ROOT/openclaw-homework-docs"
  ensure_git_repo "$IMPORT_ROOT/openclaw-homework-memory"
  ensure_git_repo "$IMPORT_ROOT/openclaw-homework-qa"

  ensure_source openclaw-homework "$IMPORT_ROOT/openclaw-homework-docs"
  ensure_source openclaw-memory "$IMPORT_ROOT/openclaw-homework-memory"
  ensure_source openclaw-qa-assets "$IMPORT_ROOT/openclaw-homework-qa"

  sync_source openclaw-homework
  sync_source openclaw-memory
  sync_source openclaw-qa-assets

  gbrain sources list
}

main "$@"
