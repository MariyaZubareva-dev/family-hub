# Production deployment: teamportal.ru

The regular `docker-compose.yml` is for local development. It must not be used
to launch production: it enables debug mode, publishes development ports, embeds
test credentials, uses the Vite development server, and runs database seeders at
container startup.

## Before the first deployment

1. On the server, make a verified database backup and record the current release
   and Docker Compose project name. Confirm that a restore has been tested.
2. Find the existing PostgreSQL Docker volume with
   `docker volume ls --format '{{.Name}}'`. Put its exact name in
   `POSTGRES_VOLUME_NAME`. Do the same for the current Redis volume and
   `REDIS_VOLUME_NAME`. Both are declared external, so Compose fails instead of
   silently creating empty volumes.
3. Copy `.env.production.example` to `.env.production` on the server. Set the
   existing DB name, user, and password. Do not rotate the database password in
   the application release; rotate it only after changing the PostgreSQL role
   and testing the new credential. Keep the populated env file out of Git.
4. Generate a fresh Laravel key in the running PHP container:

   ```sh
   docker compose exec backend php artisan key:generate --show
   ```

   This prints a new key without updating a file. Put it in the server's
   `.env.production` as `APP_KEY=...`, restrict that file to the deployment
   account, and do not send the value in chat or commit it. Changing a key
   invalidates encrypted cookies and any data encrypted with the old key; check
   for such data before changing an existing installation. Current application
   code does not use Laravel's encryption API for persisted domain data.
5. Set the real `TELEGRAM_BOT_TOKEN`. Authentication and Telegram notifications
   depend on it. Keep `APP_DEBUG=false`; the production compose file enforces it.

## Release procedure

Run these commands from the checked-out repository directory on the server.
Replace `<verified-backup-file>` with a backup path outside the checkout.

```sh
cp .env.production.example .env.production
chmod 600 .env.production
# Fill in .env.production on the server; do not paste secrets into shell history.
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
docker exec family-hub-postgres sh -lc 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > <verified-backup-file>
```

The `cp` command above is only for the initial setup. On later releases, keep the
existing `.env.production`; do not overwrite it with the example file.

Before starting the new stack, stop the existing Compose project with the same
file/override options that were used to launch it. Do not add `-v`. Confirm the
old PostgreSQL and Redis containers have stopped before reusing their volumes;
two database servers must never mount the same data volume at once. This release
has a short maintenance window while the old containers stop, migrations run,
and the production stack starts.

After verifying that the backup exists and is non-empty, deploy a reviewed
commit and apply migrations as a separate step. The seeders are deliberately
not run in production.

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend php artisan migrate --force
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl --fail --show-error https://teamportal.ru/api/v1/health
```

Then test Telegram login, one read/write action in each affected feature,
receipt upload, and a queued Telegram notification. Review backend,
queue, scheduler, and Caddy logs. Do not announce success until the checks pass.

## Slow Alpine package downloads

The backend Dockerfile accepts `ALPINE_MIRROR`. Its default remains
`https://dl-cdn.alpinelinux.org/alpine`. If downloads stall, verify another
official Alpine mirror from the server before selecting it. The override keeps
the base image's Alpine version, repository branches, and package signatures.

After confirming that no previous build is still running, use a background
build to survive SSH disconnects:

```sh
nohup sh -c '
docker compose --progress=plain --env-file .env.production -f docker-compose.prod.yml build \
  --build-arg ALPINE_MIRROR=https://mirror.yandex.ru/mirrors/alpine \
  backend queue scheduler frontend
build_result=$?
echo "BUILD_EXIT=$build_result"
exit "$build_result"
' > /root/family-hub-build.log 2>&1 < /dev/null &
```

Follow progress with `tail -f /root/family-hub-build.log`. Interrupting `tail`
does not stop the background build. Start the updated containers only after
`BUILD_EXIT=0`; a successful image build does not update running containers.

## Recovery

If the new application fails its smoke checks, restore the previous image/release
and inspect logs first. Do not run `migrate:rollback` automatically: this release
adds data tables, and rollback may delete user data. Restore the database backup
only if the migration damaged data and the recovery point is accepted; otherwise
prefer a forward fix after preserving a fresh copy of the current database.
