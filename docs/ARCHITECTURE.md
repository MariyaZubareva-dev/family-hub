# Family Hub — архитектура

## Слои

- **Frontend:** React 19 + TypeScript + Vite.
- **Backend:** Laravel 12 + PHP 8.5.
- **DB:** PostgreSQL 17.
- **Auth:** Telegram Mini App `initData` в реальном режиме; dev fallback по Telegram user id только в local.

## Модули

1. Семья и роли.
2. Календарь и события.
3. Напоминания.
4. Общие списки.
5. Личные заметки.
6. Семейные идеи.
7. Финансы для ADMIN.

## API

Все API идут через `/api/v1` и защищены `TelegramAuthenticate`, кроме `/health`.

## Права

- `ADMIN`: семейные настройки, управление участниками, событиями, списками и финансами.
- `USER`: просмотр семейных данных, добавление пунктов списка, свои заметки/идеи, создание собственных событий.
- События `APPLE_CALENDAR` считаются read-only.

## Данные

Все идентификаторы — ULID. Pivot `event_participants` намеренно не имеет собственного `id`: составной ключ `(event_id, family_member_id)` совместим с `belongsToMany()->sync()`.

## Этапы

### Этап 1 — фундамент
Docker, Laravel, PostgreSQL, Telegram auth, семья, роли, миграции, seed, API health.

### Этап 2 — MVP
Events CRUD, reminders CRUD, lists CRUD, notes CRUD, ideas CRUD, finances CRUD для ADMIN, frontend API integration.

### Этап 3 — интеграции
Apple Calendar read-only import, Telegram Bot notifications, scheduled jobs/queue.

### Этап 4 — production
Secrets management, HTTPS/reverse proxy, rate limiting, audit log, monitoring, backups, CI.
