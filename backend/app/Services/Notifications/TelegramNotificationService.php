<?php

namespace App\Services\Notifications;

use App\Jobs\TelegramNotificationJob;
use App\Models\Event;
use App\Models\Reminder;
use App\Models\FamilyMember;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class TelegramNotificationService
{
    public const TYPES = [
        'EVENT_REMINDER',
        'REMINDER',
        'EVENT_CHANGED',
        'EVENT_CANCELLED',
        'AI_READY_FOR_REVIEW',
        'BUDGET_WARNING',
    ];

    public static function notifyEventCreated(Event $event): void
    {
        self::dispatchForEvent($event, 'EVENT_CHANGED', "➕ Новое событие: {$event->title}\n{$event->start_at->format('d.m.Y H:i')} · {$event->timezone}" . ($event->location ? "\n📍 {$event->location}" : ''));
    }

    public static function notifyEventChanged(Event $event): void
    {
        self::dispatchForEvent($event, 'EVENT_CHANGED', "✏️ Событие изменено: {$event->title}\n{$event->start_at->format('d.m.Y H:i')} · {$event->timezone}");
    }

    public static function notifyEventCancelled(Event $event): void
    {
        self::dispatchForEvent($event, 'EVENT_CANCELLED', "❌ Событие отменено: {$event->title}\n{$event->start_at->format('d.m.Y H:i')}");
    }

    public static function notifyReminderDue(Reminder $reminder): void
    {
        $member = $reminder->responsibleMember;
        if (!$member) return;
        $key = "reminder:{$reminder->id}:{$reminder->scheduled_at->toIso8601String()}";
        $text = "🔔 Напоминание: {$reminder->title}" . ($reminder->description ? "\n{$reminder->description}" : '') . "\n⏰ {$reminder->scheduled_at->format('d.m.Y H:i')} · {$reminder->timezone}";
        self::dispatch(
            familyId: $reminder->family_id,
            recipientMemberId: $member->id,
            type: 'REMINDER',
            key: $key,
            text: $text,
            payload: ['reminder_id' => $reminder->id],
            scheduledAt: $reminder->scheduled_at,
            notifiable: $reminder,
        );
        // Also queue a reminder_notifications row for spec compliance
        try {
            DB::table('reminder_notifications')->updateOrInsert(
                ['reminder_id' => $reminder->id, 'scheduled_at' => $reminder->scheduled_at, 'notification_type' => 'REMINDER'],
                ['id' => (string) Str::ulid(), 'recipient_member_id' => $member->id, 'status' => 'PENDING', 'created_at' => now(), 'updated_at' => now()]
            );
        } catch (\Throwable $e) {}
    }

    public static function notifyEventReminder(Event $event, FamilyMember $recipient): void
    {
        $key = "event_reminder:{$event->id}:{$event->start_at->toIso8601String()}:{$recipient->id}";
        $text = "⏰ Скоро событие: {$event->title}\n{$event->start_at->format('d.m.Y H:i')} · {$event->timezone}" . ($event->location ? "\n📍 {$event->location}" : '');
        self::dispatch($event->family_id, $recipient->id, 'EVENT_REMINDER', $key, $text, ['event_id' => $event->id], $event->start_at, $event);
    }

    public static function notifyBudgetWarning(string $familyId, string $recipientMemberId, string $categoryName, float $spent, float $limit, float $percent): void
    {
        $key = "budget_warning:{$familyId}:" . now()->format('Y-m') . ":{$categoryName}";
        $text = "⚠️ Бюджет: категория «{$categoryName}» — потрачено " . number_format($spent, 2, ',', ' ') . " ₽ из " . number_format($limit, 2, ',', ' ') . " ₽ ({$percent}%).";
        self::dispatch($familyId, $recipientMemberId, 'BUDGET_WARNING', $key, $text, ['category' => $categoryName, 'spent' => $spent, 'limit' => $limit], now());
    }

    public static function notifyAiReady(string $familyId, string $recipientMemberId, string $receiptId): void
    {
        $key = "ai_ready:{$receiptId}";
        $text = "✅ Чек готов к проверке. Откройте Финансы → Чеки, чтобы подтвердить расходы.";
        self::dispatch($familyId, $recipientMemberId, 'AI_READY_FOR_REVIEW', $key, $text, ['receipt_id' => $receiptId], now());
    }

    private static function dispatchForEvent(Event $event, string $type, string $text): void
    {
        $event->loadMissing(['participants', 'responsibleMember']);
        $recipients = $event->participants->isNotEmpty() ? $event->participants : collect([$event->responsibleMember])->filter();
        if ($recipients->isEmpty()) {
            // fallback to all active family members
            $recipients = FamilyMember::where('family_id', $event->family_id)->where('status', 'ACTIVE')->get();
        }
        foreach ($recipients as $member) {
            $key = strtolower($type) . ":{$event->id}:{$event->updated_at->toIso8601String()}:{$member->id}";
            self::dispatch($event->family_id, $member->id, $type, $key, $text, ['event_id' => $event->id], now(), $event);
        }
    }

    private static function dispatch(string $familyId, string $recipientMemberId, string $type, string $key, string $text, array $payload, $scheduledAt, $notifiable = null): void
    {
        // ensure telegram_notifications row exists for idempotency + status tracking
        $exists = DB::table('telegram_notifications')->where('family_id', $familyId)->where('idempotency_key', $key)->exists();
        if (!$exists) {
            DB::table('telegram_notifications')->insert([
                'id' => (string) Str::ulid(),
                'family_id' => $familyId,
                'notification_type' => $type,
                'notifiable_id' => $notifiable?->id,
                'notifiable_type' => $notifiable ? get_class($notifiable) : null,
                'recipient_member_id' => $recipientMemberId,
                'payload' => json_encode($payload),
                'idempotency_key' => $key,
                'scheduled_at' => $scheduledAt instanceof \DateTimeInterface ? $scheduledAt : now(),
                'status' => 'PENDING',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        dispatch(new TelegramNotificationJob(
            notificationType: $type,
            familyId: $familyId,
            recipientMemberId: $recipientMemberId,
            idempotencyKey: $key,
            text: $text,
            payload: $payload,
            scheduledAt: $scheduledAt instanceof \DateTimeInterface ? $scheduledAt->toIso8601String() : null,
        ))->onQueue('notifications');
    }
}
