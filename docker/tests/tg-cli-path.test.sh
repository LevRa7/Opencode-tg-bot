#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

mkdir -p "${TMP_DIR}/workspace"
mkdir -p "${TMP_DIR}/state/tg-cli"

cat > "${TMP_DIR}/tg" <<'EOF'
#!/usr/bin/env sh
set -eu
printf 'TG_WORKSPACE_ROOT=%s\n' "${TG_WORKSPACE_ROOT:-}"
printf 'DATA_DIR=%s\n' "${DATA_DIR:-}"
printf 'DB_PATH=%s\n' "${DB_PATH:-}"
printf 'ARGS=%s\n' "$*"
EOF
chmod +x "${TMP_DIR}/tg"

export TG_STATE_DIR="${TMP_DIR}/state/tg-cli"
export TG_WORKSPACE_ROOT="${TMP_DIR}/state/tg-cli/workspaces"
export DATA_DIR="${TMP_DIR}/state/tg-cli/data"
export DB_PATH="${TMP_DIR}/state/tg-cli/data/messages.db"
export TG_API_ID="123"
export TG_API_HASH="abc"
export PATH="${TMP_DIR}:${PATH}"

bash "${SCRIPT_DIR}/../bin/tg-cli-wrapper.sh" > "${TMP_DIR}/output.txt"

if grep -q -- '--config' "${TMP_DIR}/output.txt"; then
  echo "FAIL: wrapper still passes a --config flag"
  cat "${TMP_DIR}/output.txt"
  exit 1
fi

grep -Fq "TG_WORKSPACE_ROOT=${TG_WORKSPACE_ROOT}" "${TMP_DIR}/output.txt"
grep -Fq "DATA_DIR=${DATA_DIR}" "${TMP_DIR}/output.txt"
grep -Fq "DB_PATH=${DB_PATH}" "${TMP_DIR}/output.txt"

echo "ok: wrapper points tg-cli at state-backed directories"
