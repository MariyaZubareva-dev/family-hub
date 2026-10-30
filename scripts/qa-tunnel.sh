#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
action=${1:-status}
compose=(docker compose --env-file .env.qa -p family-hub-qa -f docker-compose.qa.yml -f docker-compose.qa-tunnel.yml)
case "$action" in
  init)
    if [[ -e .env.qa-secrets/users.htpasswd ]]; then
      echo 'Пароль уже настроен. Используйте up.'
      exit 0
    fi
    mkdir -p .env.qa-secrets
    chmod 700 .env.qa-secrets
    echo 'Придумайте отдельный пароль для стенда. Логин: qa. Введите пароль дважды.'
    docker run --rm -it --mount "type=bind,src=$PWD/.env.qa-secrets,dst=/auth" \
      httpd:2-alpine htpasswd -c -5 /auth/users.htpasswd qa
    # Host directory is private; nginx reads this one file via a read-only bind mount.
    chmod 644 .env.qa-secrets/users.htpasswd
    ;;
  up)
    [[ -s .env.qa-secrets/users.htpasswd ]] || { echo 'Сначала выполните init.' >&2; exit 1; }
    "${compose[@]}" config --quiet
    # Stop any previous public tunnel before checking the authentication gate.
    "${compose[@]}" stop qa-tunnel
    "${compose[@]}" up -d --no-build --no-deps qa-gateway
    "${compose[@]}" exec -T qa-gateway nginx -t
    for path in / /api/v1/health; do
      code=$(curl --retry 5 --retry-connrefused --retry-delay 1 --silent --show-error --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:18081$path")
      [[ "$code" == 401 ]] || { echo "Защита не подтверждена: $path HTTP $code. Туннель не запущен." >&2; exit 1; }
    done
    echo 'Проверка входа: введите тот же пароль для qa. Он не отображается.'
    curl --fail --silent --show-error --user qa http://127.0.0.1:18081/api/v1/health
    printf '\n'
    "${compose[@]}" up -d --no-build --no-deps qa-tunnel
    echo 'Адрес появится в журнале ниже. Ctrl+C закроет просмотр; туннель продолжит работать.'
    "${compose[@]}" logs -f --tail=40 qa-tunnel
    ;;
  stop) "${compose[@]}" stop qa-tunnel qa-gateway ;;
  status) "${compose[@]}" ps qa-tunnel qa-gateway ;;
  logs) "${compose[@]}" logs --tail=60 qa-tunnel ;;
  *) echo 'Использование: bash scripts/qa-tunnel.sh {init|up|stop|status|logs}' >&2; exit 2 ;;
esac
