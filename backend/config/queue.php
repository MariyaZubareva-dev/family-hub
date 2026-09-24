<?php
return [
    'default' => env('QUEUE_CONNECTION', 'sync'),
    'connections' => [
        'sync' => ['driver' => 'sync'],
        'database' => [
            'driver' => 'database',
            'table' => 'jobs',
            'queue' => 'default',
            'retry_after' => 90,
            'after_commit' => false,
        ],
        'redis' => [
            'driver' => 'redis',
            'connection' => 'default',
            'queue' => env('REDIS_QUEUE', 'default'),
            'retry_after' => 90,
            'block_for' => null,
            'after_commit' => false,
        ],
    ],
    'batching' => ['database' => env('DB_CONNECTION', 'pgsql'), 'table' => 'job_batches'],
    'failed' => ['driver' => 'database-uuids', 'connection' => env('DB_CONNECTION', 'pgsql'), 'table' => 'failed_jobs'],
];

