<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class TelegramWelcomeTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['services.telegram.webhook_secret' => str_repeat('a', 32), 'services.telegram.bot_token' => 'test-token', 'app.url' => 'https://teamportal.ru']);
        Cache::flush();
        Http::preventStrayRequests();
    }

    private function update(int $id = 100, string $text = '/start', string $type = 'private'): array
    {
        return ['update_id' => $id, 'message' => ['text' => $text, 'chat' => ['id' => 123, 'type' => $type]]];
    }

    private function headers(): array
    {
        return ['X-Telegram-Bot-Api-Secret-Token' => str_repeat('a', 32)];
    }

    public function test_secret_is_required_and_no_message_is_sent(): void
    {
        Http::fake();
        $this->postJson('/api/telegram/webhook', $this->update())->assertForbidden();
        config(['services.telegram.webhook_secret' => '']);
        $this->postJson('/api/telegram/webhook', $this->update(), $this->headers())->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_start_has_launch_button_and_duplicate_update_is_ignored(): void
    {
        Http::fake(['*' => Http::response(['ok' => true])]);
        $this->postJson('/api/telegram/webhook', $this->update(), $this->headers())->assertOk();
        $this->postJson('/api/telegram/webhook', $this->update(), $this->headers())->assertOk();
        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => $request['chat_id'] === 123
            && $request['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] === 'https://teamportal.ru'
            && str_contains($request['text'], 'Близких можно пригласить позже'));
    }

    public function test_other_messages_and_groups_are_ignored(): void
    {
        Http::fake();
        $this->postJson('/api/telegram/webhook', $this->update(101, '/start', 'group'), $this->headers())->assertOk();
        $this->postJson('/api/telegram/webhook', $this->update(102, '/starting'), $this->headers())->assertOk();
        $this->postJson('/api/telegram/webhook', ['update_id' => 103], $this->headers())->assertOk();
        Http::assertNothingSent();
    }

    public function test_telegram_failure_can_be_retried(): void
    {
        Http::fake(['*' => Http::sequence()->push(['ok' => false], 503)->push(['ok' => true])]);
        $this->postJson('/api/telegram/webhook', $this->update(), $this->headers())->assertStatus(503);
        $this->postJson('/api/telegram/webhook', $this->update(), $this->headers())->assertOk();
        Http::assertSentCount(2);
    }

    public function test_setup_does_not_replace_another_webhook(): void
    {
        Http::fake(['*' => Http::response(['ok' => true, 'result' => ['url' => 'https://example.com/other']])]);
        $this->artisan('family:setup-telegram --webhook')->assertFailed();
        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => str_ends_with($request->url(), '/getWebhookInfo'));
    }

    public function test_setup_registers_secret_without_dropping_updates(): void
    {
        Http::fake(['*' => Http::response(['ok' => true, 'result' => ['url' => '']])]);
        $this->artisan('family:setup-telegram --webhook')->assertSuccessful();
        Http::assertSent(fn ($request) => str_ends_with($request->url(), '/setWebhook')
            && $request['secret_token'] === str_repeat('a', 32)
            && $request['drop_pending_updates'] === false);
    }
}
