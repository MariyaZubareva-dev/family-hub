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

    public function updating(Reminder $reminder): void
    {
        $scheduleChanged = $reminder->isDirty(['scheduled_at', 'responsible_member_id', 'responsible_member_ids']);
        if ($scheduleChanged || $reminder->isDirty('status')) {
            $reminder->notification_revision = (int) $reminder->notification_revision + 1;
        }
        if ($scheduleChanged || ($reminder->isDirty('status') && $reminder->status === 'SCHEDULED'
            && $reminder->scheduled_at->isFuture())) {
            $reminder->notification_sent_at = null;
        }
    }

    public function updated(Reminder $reminder): void
    {
        $statusChanged = $reminder->wasChanged('status');
        if ($statusChanged && in_array($reminder->status, ['CANCELLED', 'COMPLETED'], true)) {
            // cancel pending notifications
            try {
                \Illuminate\Support\Facades\DB::table('telegram_notifications')
                    ->where('notifiable_id', $reminder->id)
                    ->where('status', 'PENDING')
                    ->where('notification_type', 'REMINDER')
                    ->update(['status' => 'FAILED', 'error_code' => $reminder->status, 'updated_at' => now()]);
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
