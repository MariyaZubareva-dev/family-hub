<?php

namespace App\Jobs;

use App\Models\FamilyInvitation;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class SendFamilyInvitation implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public array $backoff = [60, 300, 900];

    public function __construct(public string $invitationId) {}

    public function handle(): void
    {
        $invitation = FamilyInvitation::with(['family', 'inviter'])->find($this->invitationId);
        if (!$invitation || $invitation->status !== FamilyInvitation::PENDING
            || !$invitation->telegram_user_id || $invitation->expires_at?->isPast()) return;

        $token = (string) config('services.telegram.bot_token');
        if ($token === '') {
            Log::warning('Family invitation notification: bot token missing', ['invitation_id' => $this->invitationId]);
            return;
        }

        $key = "family-invitation:{$invitation->id}:sent";
        $lock = Cache::lock("{$key}:lock", 30);
        if (!$lock->get()) { $this->release(30); return; }
        try {
            if (Cache::has($key)) return;
            $url = rtrim((string) config('app.url'), '/') . '/?section=family';
            $message = [
                'chat_id' => $invitation->telegram_user_id,
                'text' => ($invitation->inviter?->first_name ?? 'Администратор') . ' приглашает вас в семью «' . $invitation->family->name . '».'
                    . "\nОткройте Family Hub → Семья и нажмите «Принять приглашение».",
            ];
            if (str_starts_with($url, 'https://')) {
                $message['reply_markup'] = ['inline_keyboard' => [[['text' => 'Открыть приглашение', 'web_app' => ['url' => $url]]]]];
            }
            $response = Http::timeout(10)->post("https://api.telegram.org/bot{$token}/sendMessage", $message);
            if ($response->successful() && $response->json('ok')) {
                Cache::put($key, true, now()->addDays(14));
                return;
            }
            if ($response->status() === 429 || $response->serverError()) {
                throw new RuntimeException('Family invitation notification: temporary Telegram error ' . $response->status());
            }
            // A bot cannot message a user who has not started it, or who blocked it.
            // The invitation remains available inside the authenticated Mini App.
            Log::warning('Family invitation notification rejected by Telegram', ['invitation_id' => $this->invitationId, 'status' => $response->status()]);
        } finally {
            $lock->release();
        }
    }
}
