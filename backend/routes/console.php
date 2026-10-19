<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('family:send-reminders')->everyMinute()->withoutOverlapping();
Schedule::command('family:send-event-notifications')->everyMinute()->withoutOverlapping();
Schedule::command('family:send-purchase-notifications')->dailyAt('09:00')->withoutOverlapping();

