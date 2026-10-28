<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;

class SetupTelegramBot extends Command
{
    protected $signature = 'family:setup-telegram {--webhook : Register the webhook after checking the existing URL}';
    protected $description = 'Настроить описание Family Hub, кнопку запуска и при необходимости webhook';

    public function handle(): int
    {
        $token = (string) config('services.telegram.bot_token');
        $url = rtrim((string) config('app.url'), '/');
        $secret = (string) config('services.telegram.webhook_secret');
        if ($token === '' || !filter_var($url, FILTER_VALIDATE_URL) || !str_starts_with($url, 'https://')) {
            $this->error('Нужны TELEGRAM_BOT_TOKEN и APP_URL с HTTPS.');
            return self::FAILURE;
        }
        $call = function (string $method, array $body = []) use ($token): array {
            try { $response = Http::timeout(15)->post("https://api.telegram.org/bot{$token}/{$method}", $body); }
            catch (\Throwable) { throw new \RuntimeException("Telegram недоступен: {$method}. Повторите команду позже."); }
            if (!$response->successful() || !$response->json('ok')) throw new \RuntimeException("Не выполнено: {$method}. HTTP {$response->status()}. Проверьте настройки бота.");
            return $response->json();
        };
        try {
            if ($this->option('webhook')) {
                if (!preg_match('/^[A-Za-z0-9_-]{32,256}$/', $secret)) throw new \RuntimeException('Задайте TELEGRAM_WEBHOOK_SECRET: 32–256 символов A–Z, a–z, 0–9, _ или -.');
                $existing = $call('getWebhookInfo')['result']['url'] ?? '';
                if ($existing !== '' && $existing !== $url . '/api/telegram/webhook') throw new \RuntimeException('У бота уже другой webhook. Автоматическая замена остановлена: сначала проверьте действующую интеграцию.');
            }
            $description = 'Семейные планы, покупки и расходы — в одном приложении внутри Telegram. Составляйте общий список покупок, планируйте события и ведите бюджет вместе с близкими.';
            foreach (['', 'ru'] as $language) {
                $call('setMyDescription', ['description' => $description, 'language_code' => $language]);
                $call('setMyShortDescription', ['short_description' => 'Покупки, планы и расходы семьи — вместе, в Telegram.', 'language_code' => $language]);
            }
            $call('setChatMenuButton', ['menu_button' => ['type' => 'web_app', 'text' => 'Открыть приложение', 'web_app' => ['url' => $url]]]);
            if ($this->option('webhook')) $call('setWebhook', ['url' => $url . '/api/telegram/webhook', 'secret_token' => $secret, 'allowed_updates' => ['message'], 'drop_pending_updates' => false]);
            $this->info($this->option('webhook') ? 'Описание, кнопка запуска и webhook настроены.' : 'Описание и кнопка запуска настроены. Webhook не изменён.');
            return self::SUCCESS;
        } catch (\RuntimeException $e) {
            $this->error($e->getMessage());
            return self::FAILURE;
        }
    }
}
