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

ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine

RUN sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${ALPINE_MIRROR%/}|g" /etc/apk/repositories \
    && apk add --no-cache \
    bash \
    icu-dev \
    libzip-dev \
    libpng-dev \
    libjpeg-turbo-dev \
    libwebp-dev \
    oniguruma-dev \
    postgresql-dev \
    su-exec \
    zbar \
    imagemagick \
    tesseract-ocr \
    tesseract-ocr-data-rus \
    tesseract-ocr-data-eng \
    && docker-php-ext-configure gd --with-jpeg --with-webp \
    && docker-php-ext-install \
        gd \
        intl \
        mbstring \
        pdo_pgsql \
        zip

RUN printf "post_max_size=16M\nmemory_limit=256M\nmax_execution_time=120\n" > /usr/local/etc/php/conf.d/finance-uploads.ini

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
