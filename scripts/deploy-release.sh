#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_ROOT="/opt/apps/rehearsal"
readonly RELEASES_DIR="${APP_ROOT}/releases"
readonly CURRENT_LINK="${APP_ROOT}/current"
readonly DEPLOY_SHA="${DEPLOY_SHA:?DEPLOY_SHA is required}"
readonly PRODUCTION_URL="${PRODUCTION_URL:?PRODUCTION_URL is required}"
readonly RELEASE_DIR="${RELEASES_DIR}/${DEPLOY_SHA}"
readonly COMPOSE_FILE="${RELEASE_DIR}/compose.production.yml"

if [[ ! "${DEPLOY_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "DEPLOY_SHA must be a full Git commit SHA" >&2
  exit 2
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Release compose file is missing: ${COMPOSE_FILE}" >&2
  exit 2
fi

for required_path in \
  "${APP_ROOT}/data" \
  "${APP_ROOT}/backups" \
  "${APP_ROOT}/.env" \
  "${APP_ROOT}/.env.elevenlabs" \
  "${APP_ROOT}/secrets/roman_profile_pin" \
  "${APP_ROOT}/secrets/oliver_profile_pin" \
  "${APP_ROOT}/secrets/session_secret"; do
  if [[ ! -e "${required_path}" ]]; then
    echo "Required production path is missing: ${required_path}" >&2
    exit 2
  fi
done

previous_release=""
if [[ -L "${CURRENT_LINK}" ]]; then
  previous_release="$(readlink -f "${CURRENT_LINK}")"
elif [[ -f "${APP_ROOT}/compose.production.yml" ]]; then
  previous_release="${APP_ROOT}"
fi

compose() {
  docker compose --project-name rehearsal -f "${COMPOSE_FILE}" "$@"
}

wait_for_local_health() {
  local attempts=0
  until curl -fsS http://127.0.0.1:8788/health >/dev/null; do
    attempts=$((attempts + 1))
    if (( attempts >= 30 )); then
      return 1
    fi
    sleep 2
  done
}

rollback() {
  local exit_code=$?
  trap - ERR
  echo "Deployment failed; restoring the previous application release" >&2
  if [[ -n "${previous_release}" && -f "${previous_release}/compose.production.yml" ]]; then
    docker compose --project-name rehearsal \
      -f "${previous_release}/compose.production.yml" up -d --build --remove-orphans
    wait_for_local_health || true
  else
    echo "No previous release is available for automatic rollback" >&2
  fi
  exit "${exit_code}"
}

trap rollback ERR

echo "Building release ${DEPLOY_SHA}"
compose build

echo "Creating a pre-deploy database backup"
compose run --rm --no-deps app npm run db:backup

echo "Starting release ${DEPLOY_SHA}"
compose up -d --remove-orphans
wait_for_local_health
curl -fsS "${PRODUCTION_URL%/}/health" >/dev/null

ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}.next"
mv -Tf "${CURRENT_LINK}.next" "${CURRENT_LINK}"

# Model changes are deliberate release decisions now; remove the retired auto-refresh job.
rm -f /etc/cron.d/rehearsal-model-check

mapfile -t old_releases < <(
  find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -rn \
    | awk 'NR > 5 { sub(/^[^ ]+ /, ""); print }'
)
for release in "${old_releases[@]}"; do
  if [[ "${release}" == "${RELEASES_DIR}/"* && "${release}" != "${RELEASE_DIR}" ]]; then
    rm -rf -- "${release}"
  fi
done

trap - ERR
echo "Release ${DEPLOY_SHA} is healthy"
