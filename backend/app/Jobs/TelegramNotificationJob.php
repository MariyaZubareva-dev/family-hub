<?php

namespace App\Jobs;

use App\Models\FamilyMember;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class TelegramNotificationJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public array $backoff = [60, 300, 900]; // 1m, 5m, 15m

    public function __construct(
        public string $notificationType,
        public string $familyId,
        public string $recipientMemberId,
        public string $idempotencyKey,
        public string $text,
        public array $payload = [],
        public ?string $scheduledAt = null,
    ) {}

    public function handle(): void
    {
        $token = (string) config('services.telegram.bot_token', env('TELEGRAM_BOT_TOKEN', ''));
        if ($token === '') {
            Log::warning('TelegramNotificationJob: TELEGRAM_BOT_TOKEN missing, skipping send', [
                'type' => $this->notificationType,
                'family_id' => $this->familyId,
                'key' => $this->idempotencyKey,
            ]);
            $this->markSent(null, 'skipped_no_token');
            return;
        }

        // Idempotency check — if already SENT with same key, skip
        $exists = DB::table('telegram_notifications')
            ->where('family_id', $this->familyId)
            ->where('idempotency_key', $this->idempotencyKey)
            ->where('status', 'SENT')
            ->exists();
        if ($exists) {
            Log::info('TelegramNotificationJob: idempotent skip', ['key' => $this->idempotencyKey]);
            return;
        }

        $member = FamilyMember::with('user')->find($this->recipientMemberId);
        $section = FamilyMember::notificationSection($this->notificationType);
        if (!$member || $member->family_id !== $this->familyId || $member->status !== 'ACTIVE'
            || ($section && !$member->canViewSection($section))) {
            $this->failNotification('ACCESS_REVOKED', 'Recipient no longer has access to this section.');
            return;
        }
        $chatId = $member?->user?->telegram_user_id;
        if (!$chatId) {
            $this->failNotification('NO_CHAT_ID', 'Recipient has no telegram_user_id');
            return;
        }

        $fullText = $this->text;
        if ($this->notificationType === 'REMINDER') {
            $reminder = \App\Models\Reminder::where('family_id', $this->familyId)->find($this->payload['reminder_id'] ?? '');
            if (!$reminder || $reminder->status !== 'SCHEDULED'
                || (int) $reminder->notification_revision !== (int) ($this->payload['notification_revision'] ?? 0)
                || !$this->scheduledAt || !$reminder->scheduled_at->equalTo(\Carbon\Carbon::parse($this->scheduledAt))) {
                $this->failNotification('STALE_REMINDER', 'Reminder was completed, deleted or rescheduled.');
                return;
            }
            if (DB::table('telegram_notifications')->where('family_id', $this->familyId)
                ->where('notifiable_id', $reminder->id)->where('notification_type', 'REMINDER')
                ->where('recipient_member_id', $this->recipientMemberId)->where('scheduled_at', $reminder->scheduled_at)
                ->where('status', 'SENT')->exists()) {
                $this->failNotification('ALREADY_DELIVERED', 'This reminder occurrence has already been delivered.');
                return;
            }
            // Use current text when an author edits a reminder already in the queue.
            $fullText = \App\Services\Notifications\TelegramNotificationService::reminderText($reminder);
        }
        $deepLink = $this->deepLinkForType();

        try {
            $message = [
                'chat_id' => $chatId,
                'text' => $fullText,
                'parse_mode' => 'HTML',
            ];
            if ($deepLink && str_starts_with($deepLink, 'https://')) {
                $message['reply_markup'] = ['inline_keyboard' => [[['text' => 'Открыть Family Hub', 'web_app' => ['url' => $deepLink]]]]];
            }
            $resp = Http::timeout(10)->post("https://api.telegram.org/bot{$token}/sendMessage", $message);

            if ($resp->successful()) {
                $msgId = $resp->json('result.message_id');
                $this->markSent($msgId);
                Log::info('TelegramNotificationJob sent', ['type' => $this->notificationType, 'chat_id' => $chatId, 'key' => $this->idempotencyKey]);
            } else {
                $code = 'TELEGRAM_' . $resp->status();
                $msg = (string) $resp->body();
                // Retry on 5xx / 429, fail fast on 4xx
                if ($resp->status() >= 500 || $resp->status() === 429) {
                    throw new \RuntimeException("Telegram API temporary error {$code}: {$msg}");
                }
                $this->failNotification($code, $msg);
            }
        } catch (\Throwable $e) {
            Log::warning('TelegramNotificationJob temporary failure, will retry', [
                'key' => $this->idempotencyKey,
                'attempt' => $this->attempts(),
                'error' => $e->getMessage(),
            ]);
            // Let queue retry via exception; on final failure laravel will call failed()
            throw $e;
        }
    }

    public function failed(\Throwable $e): void
    {
        $this->failNotification('FAILED_AFTER_RETRIES', $e->getMessage());
    }

    private function deepLinkForType(): ?string
    {
        $base = rtrim((string) config('app.url', env('APP_URL', '')), '/');
        if ($base === '') return null;
        return match ($this->notificationType) {
            'EVENT_REMINDER', 'EVENT_CHANGED', 'EVENT_CANCELLED', 'REMINDER' => $base . '/?section=calendar',
            'AI_READY_FOR_REVIEW', 'BUDGET_WARNING' => $base . '/?section=finance',
            'PURCHASE_DUE' => $base . '/?section=lists',
            default => $base,
        };
    }

    private function markSent(?int $messageId, ?string $note = null): void
    {
        DB::table('telegram_notifications')
            ->where('family_id', $this->familyId)
            ->where('idempotency_key', $this->idempotencyKey)
            ->update([
                'status' => 'SENT',
                'sent_at' => now(),
                'telegram_message_id' => $messageId,
                'error_code' => $note,
                'updated_at' => now(),
            ]);

        // Older reminder-delivery tables have no idempotency key. Avoid an invalid SQL
        // statement: catching a PostgreSQL error does not restore its transaction.
        if ((str_starts_with($this->idempotencyKey, 'reminder:') || str_starts_with($this->idempotencyKey, 'notification:'))
            && Schema::hasColumn('reminder_notifications', 'idempotency_key')) {
            DB::table('reminder_notifications')->where('idempotency_key', $this->idempotencyKey)
                ->update(['status' => 'SENT', 'sent_at' => now(), 'telegram_message_id' => $messageId, 'updated_at' => now()]);
        }
    }

    private function failNotification(string $code, string $msg): void
    {
        DB::table('telegram_notifications')
            ->where('family_id', $this->familyId)
            ->where('idempotency_key', $this->idempotencyKey)
            ->update([
                'status' => 'FAILED',
                'error_code' => $code,
                'error_message' => mb_substr($msg, 0, 2000),
                'updated_at' => now(),
            ]);
    }
}
