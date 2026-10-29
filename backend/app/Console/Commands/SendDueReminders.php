<?php

namespace App\Console\Commands;

use App\Models\Reminder;
use App\Services\Notifications\TelegramNotificationService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Carbon\CarbonImmutable;

class SendDueReminders extends Command
{
    protected $signature = 'family:send-reminders';
    protected $description = 'Send due Family Hub reminders to Telegram users';

    public function handle(): int
    {
        $now = CarbonImmutable::now('Europe/Moscow');
        $window = [$now->subMinutes(2)->toIso8601String(), $now->addMinute()->toIso8601String()];
        $ids = Reminder::whereNull('notification_sent_at')->where('status', 'SCHEDULED')
            ->whereBetween('scheduled_at', $window)->pluck('id');
        $count = 0;
        foreach ($ids as $id) {
            $count += DB::transaction(function () use ($id, $window) {
                $reminder = Reminder::whereKey($id)->whereNull('notification_sent_at')->where('status', 'SCHEDULED')
                    ->whereBetween('scheduled_at', $window)->lockForUpdate()->first();
                if (!$reminder) return 0;
                TelegramNotificationService::notifyReminderDue($reminder);
                $reminder->forceFill(['notification_sent_at' => now()])->save();
                return 1;
            });
        }
        $this->info("Processed {$count} reminders.");
        return self::SUCCESS;
    }
}
