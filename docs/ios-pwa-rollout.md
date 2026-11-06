# Family Hub — iOS PWA

## Status
Initial PWA shell only. Not ready for family deployment: email/password login and account linking are **not yet implemented**.

## Branch and baseline
Branch `feature/ios-pwa` forks `feature/personal-savings`, because `main` is behind active product feature branches. Verify the deployed server commit before merge/deployment.

## Implemented
- Installable web app manifest and SVG branding
- Offline error page and Service Worker restricted to non-private shell resources
- iOS viewport/safe-area styles
- Service Worker registration in production

## Important constraints
- Do not cache financial/personal API responses, credentials, or authenticated HTML.
- Avoid silently creating separate family accounts for existing Telegram users. Add email/password linking from an authenticated Telegram session, with identity verification.
- Add email verification, password reset, server-side session revocation, login rate limiting, secure httpOnly cookies + CSRF protection.
- Make `telegram_user_id` nullable **via an additive migration**; never edit the original applied migration.
- Remove unsafe development authentication from production configuration and test it at the ingress/application layers.
- Generate production PNG icons (including a 180x180 Apple touch icon and 192/512 PWA icons); SVG placeholder exists only for the first iteration.
- Production needs HTTPS, correct app route fallback and explicit cache controls for private endpoints.
- Review other feature branches, and compare with actual production code before merge.

## Acceptance checks
1. iOS Safari > Share > Add to Home Screen opens Family Hub in standalone mode.
2. Layout respects safe areas, keyboard, and the home indicator.
3. Offline launch gives an understandable error without showing private cached content.
4. Telegram users can still open the original mini app.
5. Email login reuses the existing family member/user ID, with no duplicate records.
6. Password resets, logout/revocation and rate limiting are tested.
7. No changes to production before QA approval.
