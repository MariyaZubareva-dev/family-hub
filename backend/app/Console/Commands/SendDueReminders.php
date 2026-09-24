<?php

namespace App\Console\Commands;

use App\Models\Reminder;
use App\Models\Event;
use App\Services\Notifications\TelegramNotificationService;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class SendDueReminders extends Command
{
    protected $signature = 'family:send-reminders';
    protected $description = 'Queue due Family Hub reminders and event reminders';

    public function handle(): int
    {
        $now = CarbonImmutable::now('Europe/Moscow');
        $windowStart = $now->subMinutes(2);
        $windowEnd = $now->addMinutes(1);

        // 1) Due standalone reminders (with reminder_notifications idempotency)
        $dueReminders = Reminder::with(['responsibleMember.user'])
            ->where('status', 'SCHEDULED')
            ->whereBetween('scheduled_at', [$windowStart, $windowEnd])
            ->get();

        foreach ($dueReminders as $r) {
            $alreadySent = DB::table('telegram_notifications')
                ->where('idempotency_key', "reminder:{$r->id}:{$r->scheduled_at->toIso8601String()}")
                ->where('status', 'SENT')
                ->exists();
            if ($alreadySent) continue;
            // Also check legacy flag
            if ($r->notification_sent_at) continue;
            TelegramNotificationService::notifyReminderDue($r);
            // mark legacy flag after queue (not after send, to allow retry)
            $r->forceFill(['notification_sent_at' => now()])->saveQuietly();
        }

        // 2) Event reminders — notify 30 min before start (if event starts in 30m window)
        $upcomingEvents = Event::with(['responsibleMember', 'participants'])
            ->where('status', 'SCHEDULED')
            ->whereBetween('start_at', [$now->addMinutes(29), $now->addMinutes(31)])
            ->get();

        foreach ($upcomingEvents as $event) {
            // participants + responsible
            $recipients = $event->participants->isNotEmpty() ? $event->participants : collect([$event->responsibleMember])->filter();
            foreach ($recipients as $member) {
                $key = "event_reminder:{$event->id}:{$event->start_at->toIso8601String()}:{$member->id}";
                $exists = DB::table('telegram_notifications')->where('idempotency_key', $key)->where('status', 'SENT')->exists();
                if ($exists) continue;
                TelegramNotificationService::notifyEventReminder($event, $member);
            }
        }

        $this->info("Processed {$dueReminders->count()} reminders, {$upcomingEvents->count()} upcoming events.");
        return self::SUCCESS;
    }
}
