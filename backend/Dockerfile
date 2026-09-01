FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock* ./
RUN composer install --no-interaction --prefer-dist --optimize-autoloader --no-scripts

FROM php:8.5-cli-alpine
RUN apk add --no-cache \
    bash \
    icu-dev \
    libzip-dev \
    oniguruma-dev \
    postgresql-dev \
    && docker-php-ext-install intl mbstring pdo_pgsql zip
WORKDIR /var/www/html
COPY --from=vendor /app/vendor ./vendor
COPY . .
RUN mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && chown -R www-data:www-data storage bootstrap/cache
EXPOSE 8000
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
