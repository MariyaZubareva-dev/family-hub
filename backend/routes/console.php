<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('family:send-reminders')->everyMinute()->withoutOverlapping();

