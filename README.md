# Family Hub

Рабочая локальная версия семейного Telegram Mini App.

## Что уже работает

- PostgreSQL + Laravel 12 + React/Vite в Docker.
- Telegram Mini App auth через `initData`.
- Local dev auth через `X-Dev-Telegram-User-Id`.
- Seed с Марией (`423597651`) и Андреем.
- Семья и роли `ADMIN/USER`.
- События: list/create/read/update/delete.
- Напоминания: list/create/update/delete.
- Общие списки и пункты с отметкой выполнения.
- Личные заметки.
- Семейные идеи.
- Финансы с доступом только для ADMIN: операции, бюджет, дневной лимит, годовой план, подушка, крупные расходы, кредитный калькулятор.
- Frontend больше не зависит от `mock.ts`.
- Pivot `event_participants` исправлен для Eloquent `belongsToMany`.

## Запуск с нуля

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
```

Проверка:

```bash
curl http://localhost:8000/api/v1/health
curl -H "Accept: application/json" -H "X-Dev-Telegram-User-Id: 423597651" http://localhost:8000/api/v1/me
```

UI: http://localhost:5173

## Telegram

Для локальной разработки токен не требуется.
Для настоящего Mini App задайте `TELEGRAM_BOT_TOKEN` в корневом `.env`. Middleware проверяет подпись `initData`.

## Полезные команды

```bash
docker compose ps
docker compose logs backend --tail=100
docker compose exec backend php artisan migrate:status
docker compose exec backend php artisan route:list
```

## Этапы после MVP

Apple Calendar import → Telegram notifications/queue → production security/observability.

## Финансы

Финансовый раздел объединяет историю операций и калькуляторы, перенесённые из предоставленных таблиц.

### Расчёты
- «Единственное важное число»: недельный лимит гибких расходов = гибкие расходы / 4,3.
- Дневной лимит: (доход − фиксированные расходы − накопления − расходы на будущее) / дни месяца. Безопасно потратить сегодня = дневной лимит × прошедшие дни − фактические гибкие траты текущего месяца.
- Годовой бюджет: 12-месячная матрица категорий с месячными и годовыми итогами.
- Подушка: целевая сумма = ежемесячный бюджет × 3–6 месяцев; оставшаяся сумма и требуемый ежемесячный взнос рассчитываются автоматически.
- Крупные расходы: ежемесячный взнос = стоимость цели / периодичность в месяцах; отдельно считаются обязательные и желательные расходы.
- Кредиты: аннуитетный платёж = P × r / (1 − (1+r)^−n); доступна симуляция досрочного погашения с сокращением срока или уменьшением платежа.

Исходные таблицы содержали одну повреждённую формулу `#REF!` в графике погашения кредита; она не переносится, вместо неё используется устойчивый расчёт амортизации.

## Кредиты

В разделе «Финансы → Кредиты» можно создавать несколько кредитов. Для каждого кредита задаются сумма, ставка, стандартный платеж, дата старта, день ежемесячного платежа и способ пересчета после досрочных взносов. Досрочные платежи сохраняются по датам и автоматически влияют на график.


## Credit schedule update

Версия включает `term_months` и перерасчёт фактической досрочки: в день регулярного платежа досрочка идёт в тело после обычного платежа; после даты платежа сначала закрываются дополнительно начисленные проценты, затем тело. Для договорного графика используется срок кредита, а не обратный расчёт срока из ежемесячного платежа.

## Credit contract schedule

The credit module now supports an editable contractual payment schedule (`from_month`, `to_month`, `amount`) and historical prepayments with actual dates and kopecks. Interest accrual uses actual calendar days with the start date excluded and the end date included; year boundaries use 365/366. Historical regular payments are reconstructed from the contractual schedule, and same-day prepayments reduce principal after the regular payment.
