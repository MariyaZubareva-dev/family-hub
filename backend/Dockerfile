FROM composer:2 AS vendor

WORKDIR /app

COPY composer.json composer.lock ./

RUN composer install \
    --no-interaction \
    --prefer-dist \
    --optimize-autoloader \
    --no-dev \
    --no-scripts


FROM php:8.5-fpm-alpine

RUN apk add --no-cache \
    bash \
    icu-dev \
    libzip-dev \
    oniguruma-dev \
    postgresql-dev \
    su-exec \
    && docker-php-ext-install \
        intl \
        mbstring \
        pdo_pgsql \
        zip

WORKDIR /var/www/html

COPY --from=vendor /app/vendor ./vendor
COPY . .

COPY docker-entrypoint.sh /usr/local/bin/family-hub-entrypoint
RUN chmod 755 /usr/local/bin/family-hub-entrypoint

RUN mkdir -p \
        storage/framework/cache/data \
        storage/framework/sessions \
        storage/framework/views \
        storage/logs \
        bootstrap/cache \
    && chown -R www-data:www-data \
        storage \
        bootstrap/cache

ENTRYPOINT ["/usr/local/bin/family-hub-entrypoint"]

EXPOSE 9000

CMD ["php-fpm", "-F"]
