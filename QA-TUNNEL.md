# Временный доступ к тестовому стенду

Требуется уже работающий стенд family-hub-qa. Дополнительная конфигурация запускает
Nginx с паролем перед frontend и Cloudflare Quick Tunnel. Домен и аккаунт Cloudflare
не нужны. Трафик тестового приложения проходит через Cloudflare; используйте только
вымышленные данные стенда. Рабочий сайт и его контейнеры не меняются.

```bash
cd /opt/family-hub-qa &&
git pull --ff-only origin feature/qa-stand &&
bash scripts/qa-tunnel.sh init &&
bash scripts/qa-tunnel.sh up
```

Docker скачает образы httpd, Nginx и cloudflared. Установка программ на хост не нужна.
При init введите новый отдельный пароль дважды. Логин: `qa`.
При up повторите пароль для проверки входа. Пароль не передаётся в аргументах команд,
не записывается в репозиторий и не печатается. Хеш хранится в закрытом каталоге
`.env.qa-secrets`, исключённом из Git и контекста Docker существующими правилами `.env.*`.

До запуска туннеля скрипт проверяет HTTP 401 без пароля для страницы и API,
а затем успешный доступ к health с паролем. При неудаче туннель не запускается.
Адрес вида `https://….trycloudflare.com` появится в журнале. При новом запуске он может измениться.
Пришлите адрес помощнику; пароль в чат не отправляйте. Для входа понадобится защищённая
форма авторизации браузера или ручной вход в предоставленном браузере, если он поддерживается.
Автоматический вход помощника не гарантирован до проверки доступного способа авторизации.

Ctrl+C прекращает только просмотр журнала. Для закрытия внешнего доступа:

```bash
cd /opt/family-hub-qa && bash scripts/qa-tunnel.sh stop
```

Локальный стенд продолжит работать. Порты 18080 и 18081 привязаны к 127.0.0.1;
база и API отдельно наружу не публикуются. Туннель ведёт только на Nginx с паролем.
Его автоматический перезапуск отключён. Quick Tunnel предназначен для временной проверки,
а не постоянного размещения приложения.

Проверки подготовки: синтаксис Bash, разбор YAML, адрес туннеля, привязка портов,
порядок проверки пароля перед публикацией. Docker-запуск в среде подготовки недоступен;
фактический результат подтверждается выводом серверного скрипта.

Источники:
- https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
- https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html
- https://httpd.apache.org/docs/2.4/en/programs/htpasswd.html

## Альтернатива: адрес на домене приложения

Если домен `teamportal.ru` доступен в браузере, стенд можно временно открыть как
`https://teamportal.ru/qa/`. Тестовая сборка использует базовый путь `/qa/`
и API-префикс `/qa/api/v1`; шлюз с Basic Auth защищает страницу и API.

Этот способ требует дополнительного маршрута на production Caddy, поэтому его нужно
включать отдельно. Внутри блока `teamportal.ru` в
`/opt/family-hub/docker/caddy/Caddyfile` добавь:

```caddyfile
    redir /qa /qa/ 308
    handle_path /qa/* {
        reverse_proxy qa-gateway:80
    }
```

Затем из каталога production-кода подключи Caddy к сети тестового Compose-проекта:

```bash
cd /opt/family-hub &&
docker compose --env-file .env.production -p family-hub \
  -f docker-compose.prod.yml \
  -f /opt/family-hub-qa/docker-compose.prod-qa.yml \
  config --quiet &&
docker compose --env-file .env.production -p family-hub \
  -f docker-compose.prod.yml \
  -f /opt/family-hub-qa/docker-compose.prod-qa.yml \
  up -d --no-deps caddy
```

Обнови QA frontend:

```bash
cd /opt/family-hub-qa &&
git pull --ff-only origin feature/qa-stand &&
docker compose --env-file .env.qa -p family-hub-qa -f docker-compose.qa.yml \
  up -d --build --no-deps frontend
```

Затем включи уже настроенный password gateway:

```bash
cd /opt/family-hub-qa &&
bash scripts/qa-tunnel.sh init &&
docker compose --env-file .env.qa -p family-hub-qa \
  -f docker-compose.qa.yml -f docker-compose.qa-tunnel.yml \
  up -d --no-deps qa-gateway
```

Открой `https://teamportal.ru/qa/`, логин — `qa`, пароль — заданный при init.
После проверки удали маршрут `/qa` из production Caddyfile и перепримени Caddy;
останови только gateway. Стендовые контейнеры и база останутся доступны локально.

Подключение Caddy к QA-сети и применение маршрута меняют production reverse proxy,
хотя сами рабочие frontend, backend и данные не затрагиваются. Перед этим проверь
активный production Compose-проект командой `docker compose ls`.
До выполнения этих шагов маршрут не считается установленным или проверенным.
