#!/usr/bin/env bash
set -euo pipefail

env_file="${CODEX_BROWSER_ENV_FILE:-.env.codex.local}"
if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file. Create the ignored local browser-test environment first." >&2
  exit 1
fi

set -a
source "$env_file"
set +a

exec npm run dev
