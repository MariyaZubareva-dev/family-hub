# Family Hub: email/password auth — QA handoff

## Source
Feature branch `feature/ios-pwa`, based on `feature/personal-savings`. Existing Telegram login remains supported. **Do not deploy to production yet.**

## Implemented
- Additive migration makes `users.telegram_user_id` nullable, adds unique email/password hash/email verification timestamp.
- Browser auth sessions with random 256-bit tokens, SHA-256 hashes stored in DB, HttpOnly Secure SameSite=Lax cookie; CSRF on browser mutations.
- Email registration, six-digit email verification, limited retries and expiry, code resend, login, logout, password reset.
- Telegram users may link an email/password through a Telegram-signed request and verify ownership by email.
- Existing family member/user ID is reused after linking.
- iOS login screen and shared authentication headers across App, FinanceScreen and ShoppingScreen.
- Password and email are hidden from general user serialization.
- Email-only users cannot match Telegram invitations by NULL identifier.

## Required environment
Email delivery **is not configured by this PR**. Supply real SMTP values through deployment secrets before QA registration/verification:
`MAIL_MAILER=smtp`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` and, when applicable, `MAIL_SCHEME`. Never commit credentials. The default `log` mailer is not suitable for real users.

Use HTTPS and `APP_ENV=production` on deployed services. Ensure `APP_DEBUG=false`. Verify proxies, same-origin cookie delivery, SMTP outbound access, and strict CORS. Restrict any development Telegram ID header to local isolated QA only.

## Manual QA matrix
1. Existing Telegram user links email/password, receives code and verifies. Login in Safari shows the same family, finances and pots; Telegram still works.
2. Password is never serialized in `/me` or family membership responses.
3. Incorrect password, invalid/expired verification code, rate-limited attempts.
4. Registration with email-only account, verify, log in, create family; Telegram invites must not leak.
5. Logged-in user reloads Safari and keeps the session; logout revokes session immediately.
6. Browser POST without CSRF must return 419; forged cross-site Origin must return 403.
7. Reset password revokes all browser sessions. Old password no longer works.
8. All screens: shopping, planned purchases, store list, calendar, finance/credits, personal savings and receipt upload.
9. iOS PWA install, startup and home-screen icon. Browser sessions persist across app relaunch.
10. Production smoke check must verify no dev bypass and that Telegram bot/webhook is unchanged.

## Known limitations before release
- No successful PHP/TypeScript build or end-to-end QA performed through the remote GitHub connector.
- No real SMTP account configured or tested.
- No verified current production commit; compare with server to reconcile newer feature branches.
- Consider a time-based cleanup for expired `browser_sessions`.
- New email-only accounts can create a family; email-based family invitations are not yet implemented.

## Временный вход без Resend: отдельный iOS QA

В репозитории предусмотрены отдельные `docker-compose.ios-qa.yml`, `scripts/ios-qa.sh` и `IosQaSeeder`. Эти файлы используют **отдельную** базу `family_hub_qa` и Docker volumes `ios_qa_pgdata`, `ios_qa_storage`. Наружу контейнер слушает **только** `127.0.0.1:18082`. Основная система на `teamportal.ru` не меняется.

Для проверки на сервере нужно создать отдельный Git worktree. Ниже команды для оператора, работающего непосредственно по SSH на VPS (команды здесь не выполнялись):

```sh
set -e
cd /opt/family-hub
git fetch origin feature/ios-pwa
test ! -e /opt/family-hub-ios-qa
git worktree add --detach /opt/family-hub-ios-qa origin/feature/ios-pwa
cd /opt/family-hub-ios-qa
bash scripts/ios-qa.sh up
bash scripts/ios-qa.sh check
bash scripts/ios-qa.sh provision
```

Команда `provision` интерактивно запросит email и пароль два раза **без отображения пароля** и свяжет их с локальной тестовой записью Telegram ID `999001`. Работает только при `APP_ENV=local`, `QA_STAND=true`, `DB_DATABASE=family_hub_qa` и не-production URL. В реальную БД доступа нет. Пароль не передаётся в командной строке и не пишется в GitHub.

Тестовый стенд доступен только из **того же сервера**, где запущен Docker: `http://127.0.0.1:18082`. Для компьютера можно создать SSH-туннель:

```sh
ssh -N -L 18082:127.0.0.1:18082 <your-vps-ssh-host>
```

Затем открыть `http://127.0.0.1:18082` на компьютере. Для доступа с iPhone потребуется отдельный HTTPS-домен/защищённый туннель. **Не открывать порт 18082 публично**, не добавлять QA в production Caddy без ограничений и не использовать незашифрованный HTTP в интернете.

`MAIL_MAILER=log` в отдельном QA позволяет проверить работу интерфейса с уже подготовленным пользователем, но регистрация по email и восстановление пароля всё ещё требуют реальной доставки писем. Временный dev Telegram header при `QA_STAND=true` отключён.

Остановить стенд без удаления данных: `bash scripts/ios-qa.sh down`.

### Ограничения перед production

- По результатам `CI` должна пройти вся серверная тестовая база и PostgreSQL migration.
- Реальная почта Resend/SMTP пока не настроена.
- Сопоставить актуальную ветку с фактическим production-коммитом и перенести недостающие изменения продукта.
- После настройки HTTPS проверить iPhone Safari и установленную PWA отдельно.
