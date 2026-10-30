# Временный доступ к тестовому стенду

Требуется уже работающий `family-hub-qa`. Дополнительная конфигурация запускает
небольшой шлюз с HTML-формой входа и Cloudflare Quick Tunnel. Домен и аккаунт Cloudflare
не нужны. Трафик приложения проходит через Cloudflare; используйте только вымышленные
данные стенда. Рабочие frontend, backend и база не меняются.

```bash
cd /opt/family-hub-qa &&
git fetch origin &&
git switch feature/qa-browser-login || git switch --track -c feature/qa-browser-login origin/feature/qa-browser-login &&
git pull --ff-only &&
bash scripts/qa-tunnel.sh init &&
bash scripts/qa-tunnel.sh up
```

При `init` Docker скачает образ Python, попросит задать отдельный пароль длиной не менее
16 символов и повторить его. Логин — `qa`. В файле `.env.qa-secrets/gateway.json`
хранятся только scrypt-хеш пароля и ключ подписи сессий; файл исключён из Git и
монтируется в шлюз только для чтения. Пароль не появляется в аргументах команд и логах.

`up` собирает шлюз, проверяет, что без входа он показывает форму, и только после этого
запускает туннель. Адрес вида `https://….trycloudflare.com` появится в журнале. При
новом запуске адрес может измениться. На странице входа вводите логин `qa` и пароль,
заданный при `init`. Пароль в чат не отправляйте.

Для закрытия внешнего доступа:

```bash
cd /opt/family-hub-qa && bash scripts/qa-tunnel.sh stop
```

Локальный стенд продолжит работать. Порты 18080 и 18081 привязаны к `127.0.0.1`;
база и API отдельно наружу не публикуются. Туннель ведёт только на шлюз с формой входа,
сессия действует 8 часов. Контейнер шлюза работает без записи в файловую систему и
без Linux capabilities. Quick Tunnel предназначен для временной проверки.

## Адрес на домене приложения

Если доступен `teamportal.ru`, стенд можно временно открыть как
`https://teamportal.ru/qa/`. Тестовая сборка уже использует базовый путь `/qa/` и API
`/qa/api/v1`. Caddy направляет этот путь на тот же шлюз; форма входа и API защищены
сессионной cookie.

Внутри блока `teamportal.ru` в `/opt/family-hub/docker/caddy/Caddyfile` добавь перед
текущими `handle`:

```caddyfile
    redir /qa /qa/ 308
    handle_path /qa/* {
        reverse_proxy qa-gateway:8080
    }
```

Затем из каталога production-кода подключи Caddy к сети QA-проекта и перепримени Caddy.
Маршрут и сеть production reverse proxy меняются; frontend, backend и данные production
не меняются.

Обнови QA-сборку и шлюз:

```bash
cd /opt/family-hub-qa &&
git fetch origin &&
git switch feature/qa-browser-login || git switch --track -c feature/qa-browser-login origin/feature/qa-browser-login &&
git pull --ff-only &&
bash scripts/qa-tunnel.sh init &&
docker compose --env-file .env.qa -p family-hub-qa \
  -f docker-compose.qa.yml -f docker-compose.qa-tunnel.yml \
  up -d --build --no-deps frontend qa-gateway
```

При `init` задай новый пароль, если файл `gateway.json` ещё не создан. Затем открой
`https://teamportal.ru/qa/` и войди с логином `qa` и этим паролем.

После проверки удали маршрут `/qa` из production Caddyfile, перепроверь и перезагрузи
Caddy; останови шлюз командой `bash scripts/qa-tunnel.sh stop`. QA база и её локальные
контейнеры останутся доступны.
