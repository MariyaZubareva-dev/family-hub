#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
action=${1:-status}
compose=(docker compose --env-file .env.qa -p family-hub-qa -f docker-compose.qa.yml -f docker-compose.qa-tunnel.yml)
case "$action" in
  init)
    if [[ -e .env.qa-secrets/gateway.json ]]; then
      echo 'Пароль уже настроен. Используйте up.'
      exit 0
    fi
    mkdir -p .env.qa-secrets
    chmod 700 .env.qa-secrets
    docker run --rm -it \
      --mount "type=bind,src=$PWD/.env.qa-secrets,dst=/auth" \
      --mount "type=bind,src=$PWD/scripts/qa-gateway-init.py,dst=/init.py,readonly" \
      python:3.13-alpine python /init.py /auth/gateway.json
    ;;
  up)
    [[ -s .env.qa-secrets/gateway.json ]] || { echo 'Сначала выполните init.' >&2; exit 1; }
    "${compose[@]}" config --quiet
    # Stop any previous public tunnel before checking the new gateway.
    "${compose[@]}" stop qa-tunnel
    "${compose[@]}" up -d --build --no-deps qa-gateway
    headers=$(curl --retry 5 --retry-connrefused --retry-delay 1 --silent --show-error \
      --dump-header - --output /dev/null http://127.0.0.1:18081/)
    body=$(curl --retry 5 --retry-connrefused --retry-delay 1 --silent --show-error \
      http://127.0.0.1:18081/)
    [[ "$headers" == *' 401 '* && "$headers" != *'WWW-Authenticate'* && "$body" == *'name="password"'* ]] || {
      echo 'Форма входа не подтверждена; туннель не запущен.' >&2
      exit 1
    }
    "${compose[@]}" up -d --no-build --no-deps qa-tunnel
    echo 'Форма входа проверена. Адрес появится в журнале ниже.'
    "${compose[@]}" logs -f --tail=40 qa-tunnel
    ;;
  stop) "${compose[@]}" stop qa-tunnel qa-gateway ;;
  status) "${compose[@]}" ps qa-tunnel qa-gateway ;;
  logs) "${compose[@]}" logs --tail=60 qa-tunnel ;;
  *) echo 'Использование: bash scripts/qa-tunnel.sh {init|up|stop|status|logs}' >&2; exit 2 ;;
esac
