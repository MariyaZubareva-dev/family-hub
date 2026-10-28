<?php

namespace App\Http\Controllers\Telegram;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class BotWebhookController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $secret = (string) config('services.telegram.webhook_secret');
        abort_unless($secret !== '' && hash_equals($secret, (string) $request->header('X-Telegram-Bot-Api-Secret-Token')), 403);
        $data = $request->validate([
            'update_id' => ['required', 'integer', 'min:0'],
            'message' => ['sometimes', 'array'],
            'message.text' => ['sometimes', 'string', 'max:4096'],
            'message.chat.id' => ['required_with:message', 'integer'],
            'message.chat.type' => ['required_with:message', 'string'],
        ]);
        $message = $data['message'] ?? [];
        if (($message['chat']['type'] ?? '') !== 'private'
            || !preg_match('/^\/(start|help)(?:@[A-Za-z0-9_]+)?(?:\s|$)/', $message['text'] ?? '')) {
            return response()->json(['ok' => true]);
        }
        $token = (string) config('services.telegram.bot_token');
        $url = rtrim((string) config('app.url'), '/');
        abort_unless($token !== '' && str_starts_with($url, 'https://'), 503);
        $key = 'telegram-welcome:' . $data['update_id'];
        $lock = Cache::lock($key . ':lock', 20);
        if (!$lock->get()) return response()->json(['ok' => false], 503);
        try {
            if (Cache::has($key)) return response()->json(['ok' => true]);
            $text = "Меньше держать в голове. Больше делать вместе.\n\n"
                . "Family Hub — покупки, планы и расходы семьи в одном приложении внутри Telegram.\n\n"
                . "🛒 Общий список покупок — что нужно купить.\n"
                . "📅 События и напоминания — что запланировано.\n"
                . "💳 Доходы и расходы — сколько потратили.\n\n"
                . "Начните с одной задачи. Близких можно пригласить позже. Если вас уже пригласили, приглашение появится при входе.";
            try {
                $response = Http::timeout(10)->post("https://api.telegram.org/bot{$token}/sendMessage", [
                    'chat_id' => $message['chat']['id'],
                    'text' => $text,
                    'reply_markup' => ['inline_keyboard' => [[['text' => 'Открыть Family Hub', 'web_app' => ['url' => $url]]]]],
                ]);
            } catch (\Throwable) {
                // Never include request URLs containing the bot token in exceptions or logs.
                return response()->json(['ok' => false], 503);
            }
            if (!$response->json('ok') && $response->status() !== 403) return response()->json(['ok' => false], 503);
            Cache::put($key, true, now()->addDays(7));
            return response()->json(['ok' => true]);
        } finally {
            $lock->release();
        }
    }
}
