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
        $chatId = $member?->user?->telegram_user_id;
        if (!$chatId) {
            $this->failNotification('NO_CHAT_ID', 'Recipient has no telegram_user_id');
            return;
        }

        $deepLink = $this->deepLinkForType();
        $fullText = $this->text . ($deepLink ? "\n\nОткрыть в Family Hub: {$deepLink}" : '');

        try {
            $resp = Http::timeout(10)->post("https://api.telegram.org/bot{$token}/sendMessage", [
                'chat_id' => $chatId,
                'text' => $fullText,
                'parse_mode' => 'HTML',
            ]);

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
            'EVENT_REMINDER', 'EVENT_CHANGED', 'EVENT_CANCELLED' => $base . '/calendar',
            'REMINDER' => $base . '/calendar',
            'AI_READY_FOR_REVIEW' => $base . '/finance',
            'BUDGET_WARNING' => $base . '/finance',
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

        // Also update reminder_notifications if applicable
        if (str_starts_with($this->idempotencyKey, 'reminder:') || str_starts_with($this->idempotencyKey, 'notification:')) {
            try {
                DB::table('reminder_notifications')
                    ->where('idempotency_key', $this->idempotencyKey)
                    ->update(['status' => 'SENT', 'sent_at' => now(), 'telegram_message_id' => $messageId, 'updated_at' => now()]);
            } catch (\Throwable $e) {
                // reminder_notifications may not have idempotency_key column — ignore
            }
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
