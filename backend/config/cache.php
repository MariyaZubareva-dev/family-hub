<?php
return [
    'default' => env('CACHE_STORE', 'file'),
    'stores' => [
        'array' => ['driver' => 'array', 'serialize' => false],
        'file' => ['driver' => 'file', 'path' => storage_path('framework/cache/data'), 'lock_path' => storage_path('framework/cache/data')],
        'redis' => ['driver' => 'redis', 'connection' => 'cache', 'lock_connection' => 'default'],
        'database' => ['driver' => 'database', 'table' => 'cache', 'connection' => env('DB_CONNECTION', 'pgsql'), 'lock_connection' => env('DB_CONNECTION', 'pgsql')],
    ],
    'prefix' => env('CACHE_PREFIX', 'family-hub'),
];
