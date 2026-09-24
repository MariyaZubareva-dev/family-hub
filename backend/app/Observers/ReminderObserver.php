<?php

namespace App\Observers;

use App\Models\Reminder;
use App\Services\Notifications\TelegramNotificationService;
use Illuminate\Support\Facades\Log;

class ReminderObserver
{
    public function created(Reminder $reminder): void
    {
        // Reminders are notified via scheduler at scheduled_at, not immediately.
        // But if scheduled_at is in near past (overdue), notify immediately.
        if ($reminder->scheduled_at && $reminder->scheduled_at->isPast()) {
            try { TelegramNotificationService::notifyReminderDue($reminder); } catch (\Throwable $e) { Log::warning('ReminderObserver created notify failed', ['id' => $reminder->id, 'error' => $e->getMessage()]); }
        }
    }

    public function updated(Reminder $reminder): void
    {
        // If scheduled_at or responsible changed, the scheduler will pick up new time via notification_sent_at reset.
        if ($reminder->wasChanged('scheduled_at') || $reminder->wasChanged('responsible_member_id')) {
            $reminder->forceFill(['notification_sent_at' => null])->saveQuietly();
        }
        if ($reminder->wasChanged('status') && $reminder->status === 'CANCELLED') {
            // cancel pending notifications
            try {
                \Illuminate\Support\Facades\DB::table('telegram_notifications')
                    ->where('notifiable_id', $reminder->id)
                    ->where('status', 'PENDING')
                    ->where('notification_type', 'REMINDER')
                    ->update(['status' => 'FAILED', 'error_code' => 'CANCELLED', 'updated_at' => now()]);
            } catch (\Throwable $e) {}
        }
    }

    public function deleted(Reminder $reminder): void
    {
        try {
            \Illuminate\Support\Facades\DB::table('telegram_notifications')
                ->where('notifiable_id', $reminder->id)
                ->where('status', 'PENDING')
                ->update(['status' => 'FAILED', 'error_code' => 'DELETED', 'updated_at' => now()]);
        } catch (\Throwable $e) {}
    }
}
