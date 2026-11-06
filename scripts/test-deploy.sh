#!/usr/bin/env bash
set -Eeuo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT
export MOCK_LOG="$scratch/docker.log"
export MOCK_CONTAINER_IDS=''
export PATH="$scratch/bin:$PATH"

cat > "$scratch/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$1" in
  network) [[ "$2" == inspect ]] ;;
  pull) printf 'pull %s\n' "$2" >> "$MOCK_LOG" ;;
  ps)
    if [[ "$*" == *'network=web'* && "${MOCK_CONFLICT:-0}" == 1 ]]; then
      printf 'route-owner-container\n'
    else
      printf '%s\n' "$MOCK_CONTAINER_IDS"
    fi
    ;;
  inspect)
    if [[ "$*" == *'com.docker.compose.project'* ]]; then
      printf 'another-project\n'
    elif [[ "$*" == *'json .Config.Labels'* ]]; then
      printf '{"router":"Host(`remote.example.com`)"}\n'
    elif [[ "$*" == *'.Config.Image'* ]]; then
      printf '%s\n' 'remote-control-agent:existing'
    else
      printf '%s\n' 'healthy'
    fi
    ;;
  compose)
    printf 'compose %s\n' "$*" >> "$MOCK_LOG"
    case " $* " in
      *' ps -a -q app '*) printf 'mock-app-container\n' ;;
    esac
    ;;
  *) echo "Unexpected docker command: $*" >&2; exit 1 ;;
esac
MOCK

cat > "$scratch/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${MOCK_PUBLIC_HEALTH:-ok}" == ok ]]; then
  printf '{"status":"ok","at":1}\n200'
else
  printf '{"status":"unavailable"}\n503'
  exit 22
fi
MOCK

chmod +x "$scratch/bin/docker" "$scratch/bin/curl"
cat > "$scratch/root/infrastructure/.env" <<'ENV'
APP_DOMAIN=remote.example.com
TRAEFIK_NETWORK=web
TRAEFIK_CERTRESOLVER=letsencrypt
ENV
cat > "$scratch/root/infrastructure/backend.env" <<'ENV'
PUBLIC_ORIGIN=https://remote.example.com
COOKIE_SECURE=true
TRUST_PROXY=true
HOST=0.0.0.0
PORT=4000
DB_PATH=/data/rca.sqlite
ENV
chmod 600 "$scratch/root/infrastructure/backend.env"

sha_a="$(printf 'a%.0s' {1..40})"
sha_b="$(printf 'b%.0s' {1..40})"
image_a="ghcr.io/example/remote-control-agent:$sha_a"
image_b="ghcr.io/example/remote-control-agent:$sha_b"
for sha in "$sha_a" "$sha_b"; do
  sha="..."
  mkdir -p "$scratch/root/releases/$sha/infrastructure"
  cp "$repo/infrastructure/compose.prod.yml" \
    "$scratch/root/releases/$sha/infrastructure/compose.prod.yml"
done

bash "$repo/scripts/deploy.sh" apply "$scratch/root" "$sha_a" "$image_a"
bash "$repo/scripts/deploy.sh" verify "$scratch/root" "$sha_a"
[[ "$(sed -n 's/^RELEASE_SHA=//p' "$scratch/root/shared/current-release.env")" == "$sha_a" ]]
[[ ! -e "$scratch/root/shared/pending-release.env" ]]

bash "$repo/scripts/deploy.sh" apply "$scratch/root" "$sha_b" "$image_b"
if MOCK_PUBLIC_HEALTH=bad bash "$repo/scripts/deploy.sh" verify "$scratch/root" "$sha_b" >/dev/null 2>&1; then
  echo 'Unhealthy HTTPS response was accepted' >&2
  exit 1
fi
MOCK_PUBLIC_HEALTH=ok bash "$repo/scripts/deploy.sh" rollback "$scratch/root" "$sha_b"
[[ "$(sed -n 's/^RELEASE_SHA=//p' "$scratch/root/shared/current-release.env")" == "$sha_a" ]]
[[ "$(sed -n 's/^IMAGE=//p' "$scratch/root/shared/current-release.env")" == "$image_a" ]]
[[ ! -e "$scratch/root/shared/pending-release.env" ]]
grep -q "up -d --no-deps --no-build --wait --wait-timeout 180 app" "$MOCK_LOG"

sha_c="$(printf 'c%.0s' {1..40})"
image_c="ghcr.io/example/remote-control-agent:$sha_c"
mkdir -p "$scratch/root/releases/$sha_c"
cp "$repo/infrastructure/compose.prod.yml" "$scratch/root/releases/$sha_c/compose.prod.yml"
if MOCK_CONFLICT=1 bash "$repo/scripts/deploy.sh" apply "$scratch/root" "$sha_c" "$image_c" >/dev/null 2>&1; then
  echo 'An existing Traefik router conflict was accepted' >&2
  exit 1
fi
if grep -q "pull $image_c" "$MOCK_LOG"; then
  echo 'Image was pulled despite a Traefik router conflict' >&2
  exit 1
fi
echo 'Deploy flow: immutable release, HTTPS promotion, and rollback passed'
