<?php

namespace App\Services\Telegram;

use RuntimeException;

class TelegramInitDataValidator
{
    public function validate(string $initData): array
    {
        parse_str($initData, $data);
        $hash = $data['hash'] ?? null;
        unset($data['hash']);

        if (!$hash) {
            throw new RuntimeException('Telegram initData hash is missing.');
        }

        $botToken = (string) config('services.telegram.bot_token');
        if ($botToken === '') {
            throw new RuntimeException('Telegram bot token is not configured.');
        }

        ksort($data);
        $checkString = collect($data)
            ->map(fn ($value, $key) => $key . '=' . $value)
            ->implode("\n");

        $secret = hash_hmac('sha256', $botToken, 'WebAppData', true);
        $calculated = hash_hmac('sha256', $checkString, $secret);

        if (!hash_equals($calculated, $hash)) {
            throw new RuntimeException('Telegram initData signature is invalid.');
        }

        if (isset($data['auth_date']) && now()->timestamp - (int) $data['auth_date'] > 86400) {
            throw new RuntimeException('Telegram initData is expired.');
        }

        $data['user'] = isset($data['user']) ? json_decode($data['user'], true) : null;
        return $data;
    }
}
