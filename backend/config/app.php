<?php
use Illuminate\Support\ServiceProvider;
return [
 'name'=>env('APP_NAME','FamilyHub'),'env'=>env('APP_ENV','local'),'debug'=>(bool)env('APP_DEBUG',true),
 'url'=>env('APP_URL','http://localhost:8000'),'timezone'=>env('APP_TIMEZONE','Europe/Moscow'),
 'locale'=>env('APP_LOCALE','ru'),'fallback_locale'=>env('APP_FALLBACK_LOCALE','ru'),'faker_locale'=>env('APP_FAKER_LOCALE','ru_RU'),
 'key'=>env('APP_KEY'),'cipher'=>'AES-256-CBC','maintenance'=>['driver'=>'file'],
 'providers'=>ServiceProvider::defaultProviders()->merge([App\Providers\AppServiceProvider::class])->toArray(),
];
