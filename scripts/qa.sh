#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
action=${1:-status}
case "$action" in up|down|status|logs|check) ;; *) echo 'Использование: bash scripts/qa.sh {up|down|status|logs|check}' >&2; exit 2;; esac
command -v docker >/dev/null || { echo 'Нужен Docker с Compose v2.' >&2; exit 1; }
docker compose version >/dev/null
if [[ "$action" == up && ! -f .env.qa ]]; then
  command -v openssl >/dev/null || { echo 'Нужен openssl для создания ключей.' >&2; exit 1; }
  (umask 077; printf 'QA_APP_KEY=base64:%s\nQA_DB_PASSWORD=%s\n' "$(openssl rand -base64 32)" "$(openssl rand -hex 24)" > .env.qa)
fi
[[ -f .env.qa ]] || { echo 'Сначала выполните: bash scripts/qa.sh up' >&2; exit 1; }
compose=(docker compose --env-file .env.qa -p family-hub-qa -f docker-compose.qa.yml)
case "$action" in
  up)
    command -v curl >/dev/null || { echo 'Нужен curl для проверки веб-входа.' >&2; exit 1; }
    "${compose[@]}" config --quiet
    "${compose[@]}" up -d --build --wait --wait-timeout 180
    bash scripts/qa.sh check
    curl --fail --silent --show-error http://127.0.0.1:18080/api/v1/health
    curl --fail --silent --show-error http://127.0.0.1:18080/ > /dev/null
    echo 'Стенд: http://localhost:18080 — только локальный доступ.'
    ;;
  down) "${compose[@]}" down;;
  status) "${compose[@]}" ps;;
  logs) "${compose[@]}" logs --tail=100;;
  check) "${compose[@]}" exec -T backend php < scripts/qa-smoke.php;;
esac
