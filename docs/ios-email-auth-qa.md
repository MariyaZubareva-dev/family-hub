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

## Временный вход без Resend (только изолированный QA)

Чтобы проверить Safari PWA до восстановления DNS, можно один раз включить email/password для **существующего QA-пользователя**, не создавая вторую семью. Команда не посылает письмо и не требует SMTP. Это осознанное исключение только для тестовой базы.

**Никогда не запускать на production или на копии production с доступом реальных пользователей.** Команда намеренно отклоняет `APP_ENV=production` и `APP_URL=https://teamportal.ru`. Укажи на QA `APP_ENV=staging` и отдельный `APP_URL`, убедись, что база QA отдельная. Используй имеющийся QA-профиль compose, не создавай новый backend поверх production.

Из терминала QA-бэкенда (указать фактическое имя контейнера из QA compose):

```sh
php artisan family:qa-email-login 999001
```

Команда интерактивно запросит адрес, пароль дважды (без отображения), а затем подтверждение изменения **существующей** QA-записи. В базе сохраняется только hash пароля; в терминале пароль не пишется и в историю shell не попадает. После команды можно войти с QA URL по email/password. Восстановление пароля и публичная регистрация по-прежнему требуют реальной почты.

До запуска обязательно:
- подтвердить, что QA отделён от production по URL, БД и конфигурации;
- выполнить миграции на QA и резервную копию;
- убедиться, что `APP_ENV` и `APP_URL` не указаны как production;
- убедиться, что QA доступен только тестировщикам (Basic Auth / туннель);
- после тестирования отключить временный доступ/сбросить тестовый пароль при необходимости.
