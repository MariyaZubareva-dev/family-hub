#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
action="${1:-status}"
case "$action" in up|status|logs|check|provision|down) ;; *)
  echo "Usage: bash scripts/ios-qa.sh {up|status|logs|check|provision|down}" >&2
  exit 2 ;;
esac
command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker compose version >/dev/null
if [[ "$action" == "up" && ! -f .env.ios-qa ]]; then
  command -v openssl >/dev/null || { echo "openssl is required." >&2; exit 1; }
  (umask 077; printf "IOS_QA_APP_KEY=base64:%s\nIOS_QA_DB_PASSWORD=%s\n" "$(openssl rand -base64 32)" "$(openssl rand -hex 24)" > .env.ios-qa)
fi
[[ -f .env.ios-qa ]] || { echo "First run: bash scripts/ios-qa.sh up" >&2; exit 1; }
compose=(docker compose --env-file .env.ios-qa -p family-hub-ios-qa -f docker-compose.ios-qa.yml)
case "$action" in
  up)
    "${compose[@]}" config --quiet
    "${compose[@]}" up -d --build --wait --wait-timeout 240
    curl -fsS http://127.0.0.1:18082/api/v1/health
    printf '\nQA: http://127.0.0.1:18082 — only localhost; no production changes.\n'
    ;;
  status) "${compose[@]}" ps ;;
  logs) "${compose[@]}" logs --tail=120 ;;
  check)
    curl -fsS http://127.0.0.1:18082/api/v1/health
    printf '\n'
    "${compose[@]}" exec -T backend php artisan migrate:status
    ;;
  provision)
    "${compose[@]}" exec backend php artisan family:qa-email-login 999001 ;;
  down) "${compose[@]}" down ;;
esac
