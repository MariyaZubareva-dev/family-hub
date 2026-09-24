<?php

namespace App\Providers;

use App\Models\Event;
use App\Models\Reminder;
use App\Observers\EventObserver;
use App\Observers\ReminderObserver;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Event::observe(EventObserver::class);
        Reminder::observe(ReminderObserver::class);
    }
}
