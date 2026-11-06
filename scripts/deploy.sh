#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

action="${1:?Usage: deploy.sh apply|verify|rollback ROOT SHA [IMAGE]}"
root="${2:?Set the absolute VPS deployment root}"
sha="${3:?Set a full 40-character commit SHA}"
image="${4:--}"
project=infrastructure

[[ "$root" =~ ^/[A-Za-z0-9/._-]+$ && "$root" != / && "$root" != *"/../"* && "$root" != */.. ]] || {
  echo 'Invalid deployment root'; exit 1;
}
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected a full 40-character commit SHA'; exit 1; }

config_dir="$root/infrastructure"
release="$root/releases/$sha"
compose_file="$release/compose.prod.yml"
deploy_env="$config_dir/.env"
backend_env="$config_dir/backend.env"
state="$root/shared/current-release.env"
pending="$root/shared/pending-release.env"

setting() {
  local file="$1" name="$2"
  awk -v key="$name" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' "$file"
}

valid_image() {
  [[ "$1" =~ ^ghcr\.io/[a-z0-9._-]+/[a-z0-9._-]+:[a-f0-9]{40}$ ]]
}

valid_previous_image() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]*$ ]]
}

compose() {
  local target_sha="$1" target_image="$2"
  shift 2
  APP_IMAGE="$target_image" BACKEND_ENV_FILE="$backend_env" \
    docker compose -p "$project" --project-directory "$config_dir" --env-file "$deploy_env" \
      -f "$root/releases/$target_sha/compose.prod.yml" "$@"
}

check_environment() {
  [[ -f "$deploy_env" && -f "$backend_env" ]] || { echo 'VPS infrastructure/.env and backend.env are required'; return 1; }
  local mode domain network resolver origin
  mode="$(stat -c %a "$backend_env")"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 0077) == 0 )) || {
    echo 'backend.env must not be readable by group/others (chmod 600)'; return 1;
  }
  domain="$(setting "$deploy_env" APP_DOMAIN)"
  network="$(setting "$deploy_env" TRAEFIK_NETWORK)"
  resolver="$(setting "$deploy_env" TRAEFIK_CERTRESOLVER)"
  origin="$(setting "$backend_env" PUBLIC_ORIGIN)"
  [[ "$domain" =~ ^[A-Za-z0-9.-]+$ && "$domain" != .* && "$domain" != *. ]] || { echo 'Set a valid APP_DOMAIN'; return 1; }
  [[ "$network" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo 'Set a valid TRAEFIK_NETWORK'; return 1; }
  [[ "$resolver" =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Set a valid TRAEFIK_CERTRESOLVER'; return 1; }
  [[ "$origin" == "https://$domain" ]] || { echo 'PUBLIC_ORIGIN must exactly match https://APP_DOMAIN'; return 1; }
  [[ "$(setting "$backend_env" COOKIE_SECURE)" == true ]] || { echo 'COOKIE_SECURE must be true'; return 1; }
  [[ "$(setting "$backend_env" TRUST_PROXY)" == true ]] || { echo 'TRUST_PROXY must be true behind Traefik'; return 1; }
  [[ "$(setting "$backend_env" HOST)" == 0.0.0.0 && "$(setting "$backend_env" PORT)" == 4000 ]] || {
    echo 'HOST must be 0.0.0.0 and PORT must be 4000'; return 1;
  }
  [[ "$(setting "$backend_env" DB_PATH)" == /data/rca.sqlite ]] || { echo 'DB_PATH must be /data/rca.sqlite'; return 1; }
}

check_network() {
  local network
  network="$(setting "$deploy_env" TRAEFIK_NETWORK)"
  docker network inspect "$network" >/dev/null 2>&1 || { echo "Traefik network does not exist: $network"; return 1; }
}

check_router_conflicts() {
  local network domain cids cid owner labels
  network="$(setting "$deploy_env" TRAEFIK_NETWORK)"
  domain="$(setting "$deploy_env" APP_DOMAIN)"
  cids="$(docker ps -q --filter "network=$network")" || return 1
  while IFS= read -r cid; do
    [[ -n "$cid" ]] || continue
    owner="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$cid")"
    [[ "$owner" != "$project" ]] || continue
    labels="$(docker inspect -f '{{json .Config.Labels}}' "$cid")"
    if [[ "$labels" == *"Host("* && "$labels" == *"$domain"* ]]; then
      echo "Another Compose project on $network already routes $domain (container $cid)"
      return 1
    fi
  done <<< "$cids"
}

check_container() {
  local target_sha="$1" target_image="$2" cid health
  cid="$(compose "$target_sha" "$target_image" ps -a -q app)"
  [[ -n "$cid" ]] || { echo 'The app container is missing'; return 1; }
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")"
  [[ "$health" == healthy ]] || { echo "App container is not healthy ($health)"; return 1; }
}

check_public_health() {
  local domain response status body
  domain="$(setting "$deploy_env" APP_DOMAIN)"
  response="$(curl --fail --silent --show-error --max-time 20 --retry 3 --retry-delay 2 \
    --write-out $'\n%{http_code}' "https://$domain/api/health")" || return 1
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  [[ "$status" == 200 && "$body" == *'"status":"ok"'* ]] || {
    echo "Unexpected HTTPS health response for $domain (HTTP $status)"; return 1;
  }
}

read_current() {
  previous_sha=''
  previous_image=''
  if [[ -f "$state" ]]; then
    previous_sha="$(setting "$state" RELEASE_SHA)"
    previous_image="$(setting "$state" IMAGE)"
    [[ "$previous_sha" =~ ^[a-f0-9]{40}$ ]] && valid_image "$previous_image" && [[ "${previous_image##*:}" == "$previous_sha" ]] || {
      echo 'Invalid current-release.env; stop and inspect deployment state'; return 1;
    }
    [[ -f "$root/releases/$previous_sha/compose.prod.yml" ]] || {
      echo 'Previous Compose release is missing; refusing to replace it'; return 1;
    }
  else
    local ids
    ids="$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=app')"
    if [[ -n "$ids" ]]; then
      [[ "$(wc -l <<< "$ids" | tr -d ' ')" == 1 ]] || { echo 'Multiple existing app containers found; inspect before deployment'; return 1; }
      previous_image="$(docker inspect -f '{{.Config.Image}}' "$ids")"
      valid_previous_image "$previous_image" || { echo 'Could not identify the existing app image for rollback'; return 1; }
      echo "Adopting existing Compose app image for first-release rollback: $previous_image"
    fi
  fi
}

write_state() {
  local file="$1" release_sha="$2" release_image="$3"
  local temp="$file.tmp.$$"
  printf 'RELEASE_SHA=%s\nIMAGE=%s\n' "$release_sha" "$release_image" > "$temp"
  chmod 600 "$temp"
  mv -f "$temp" "$file"
}

rollback_pending() {
  [[ -f "$pending" ]] || { echo 'No pending release; no rollback needed'; return 0; }
  local pending_sha old_sha old_image candidate_image
  pending_sha="$(setting "$pending" PENDING_SHA)"
  [[ "$pending_sha" == "$sha" ]] || { echo 'Another release is pending; refusing rollback'; return 1; }
  old_sha="$(setting "$pending" PREVIOUS_SHA)"
  old_image="$(setting "$pending" PREVIOUS_IMAGE)"
  candidate_image="$(setting "$pending" CANDIDATE_IMAGE)"
  valid_image "$candidate_image" && [[ "${candidate_image##*:}" == "$pending_sha" ]] || return 1
  if [[ -z "$old_image" ]]; then
    compose "$sha" "$candidate_image" stop app || true
    compose "$sha" "$candidate_image" rm -f -s app
    echo 'First release failed; candidate app container removed and the SQLite volume was kept.'
  else
    valid_previous_image "$old_image" || return 1
    if [[ -n "$old_sha" ]]; then
      [[ "$old_sha" =~ ^[a-f0-9]{40}$ && -f "$root/releases/$old_sha/compose.prod.yml" ]] || return 1
    else
      old_sha="$sha"
    fi
    compose "$old_sha" "$old_image" up -d --no-deps --no-build --wait --wait-timeout 180 app
    check_container "$old_sha" "$old_image"
    check_public_health
    if [[ "$old_sha" != "$sha" ]]; then
      write_state "$state" "$old_sha" "$old_image"
    fi
    echo "Restored previous app image $old_image."
  fi
  rm -f "$pending"
}

rollback_on_error() {
  local result=$?
  trap - EXIT
  if (( result != 0 )) && [[ -f "$pending" ]]; then
    rollback_pending || echo 'Automatic rollback failed; inspect pending-release.env and VPS health.' >&2
  fi
  exit "$result"
}

apply_release() {
  [[ -f "$compose_file" ]] || { echo 'Release Compose file is missing'; return 1; }
  [[ ! -e "$pending" ]] || { echo 'Resolve the pending release before starting another'; return 1; }
  valid_image "$image" && [[ "${image##*:}" == "$sha" ]] || { echo 'Expected an immutable GHCR image tagged with this commit SHA'; return 1; }
  check_environment
  check_network
  check_router_conflicts
  read_current
  compose "$sha" "$image" config --quiet
  docker pull "$image"
  mkdir -p "$root/shared"
  {
    printf 'PENDING_SHA=%s\nPREVIOUS_SHA=%s\n' "$sha" "$previous_sha"
    printf 'PREVIOUS_IMAGE=%s\nCANDIDATE_IMAGE=%s\n' "$previous_image" "$image"
  } > "$pending.tmp.$$"
  chmod 600 "$pending.tmp.$$"
  mv -f "$pending.tmp.$$" "$pending"
  trap rollback_on_error EXIT
  compose "$sha" "$image" up -d --no-deps --no-build --wait --wait-timeout 180 app
  check_container "$sha" "$image"
  trap - EXIT
  echo "Candidate $sha is healthy; HTTPS verification is required before promotion."
}

verify_release() {
  [[ -f "$pending" && "$(setting "$pending" PENDING_SHA)" == "$sha" ]] || {
    echo 'No matching pending release'; return 1;
  }
  local candidate_image
  candidate_image="$(setting "$pending" CANDIDATE_IMAGE)"
  valid_image "$candidate_image" && [[ "${candidate_image##*:}" == "$sha" ]] || return 1
  check_environment
  check_container "$sha" "$candidate_image"
  check_public_health
  write_state "$state" "$sha" "$candidate_image"
  write_state "$release/image.env" "$sha" "$candidate_image"
  rm -f "$pending"
  echo "Release $sha passed HTTPS health checks and was promoted."
}

case "$action" in
  apply)
    [[ $# == 4 ]] || { echo 'Apply expects ROOT SHA IMAGE'; exit 1; }
    apply_release
    ;;
  verify)
    [[ $# == 3 ]] || exit 1
    verify_release
    ;;
  rollback)
    [[ $# == 3 ]] || exit 1
    rollback_pending
    ;;
  *) echo 'Unknown deploy action'; exit 1 ;;
esac
