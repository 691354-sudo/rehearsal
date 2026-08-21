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

# Browser QA must never inherit paid API credentials from the parent shell.
unset OPENAI_API_KEY ELEVENLABS_API_KEY

exec npm run dev
