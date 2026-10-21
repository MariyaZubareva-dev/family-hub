<?php

namespace Tests\Feature;

use App\Http\Middleware\TelegramAuthenticate;
use App\Models\Family;
use App\Models\FamilyMember;
use App\Models\User;
use App\Models\Event;
use App\Models\Reminder;
use App\Services\Notifications\TelegramNotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class CalendarResponsiblesTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private FamilyMember $one;
    private FamilyMember $two;
    private FamilyMember $foreign;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware(TelegramAuthenticate::class);
        $this->owner = User::create(['telegram_user_id' => 50101, 'first_name' => 'Мария']);
        $other = User::create(['telegram_user_id' => 50102, 'first_name' => 'Андрей']);
        $foreign = User::create(['telegram_user_id' => 50103, 'first_name' => 'Другой']);
        $family = Family::create(['name' => 'Семья', 'created_by' => $this->owner->id]);
        $elsewhere = Family::create(['name' => 'Другая', 'created_by' => $foreign->id]);
        $this->one = FamilyMember::create(['family_id' => $family->id, 'user_id' => $this->owner->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        $this->two = FamilyMember::create(['family_id' => $family->id, 'user_id' => $other->id, 'role' => 'USER', 'status' => 'ACTIVE']);
        $this->foreign = FamilyMember::create(['family_id' => $elsewhere->id, 'user_id' => $foreign->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        $this->actingAs($this->owner);
    }

    private function payload(string $resource): array
    {
        $dates = $resource === 'events'
            ? ['start_at' => now()->addDay()->toIso8601String(), 'end_at' => now()->addDay()->addHour()->toIso8601String()]
            : ['scheduled_at' => now()->addDay()->toIso8601String()];
        return ['title' => 'Семейный план', 'responsible_member_ids' => [$this->one->id, $this->two->id], ...$dates];
    }

    public function test_both_types_save_multiple_responsibles_and_keep_them_on_partial_update(): void
    {
        foreach (['events', 'reminders'] as $resource) {
            $item = $this->postJson('/api/v1/'.$resource, $this->payload($resource))->assertCreated()
                ->assertJsonPath('data.responsible_member_ids', [$this->one->id, $this->two->id])
                ->assertJsonPath('data.responsible_member_id', $this->one->id)->json('data');
            $this->patchJson('/api/v1/'.$resource.'/'.$item['id'], ['title' => 'Другое название'])->assertOk()
                ->assertJsonPath('data.responsible_member_ids', [$this->one->id, $this->two->id]);
            $this->getJson('/api/v1/'.$resource)->assertOk()->assertJsonPath('data.0.responsible_member_ids', [$this->one->id, $this->two->id]);
            $this->patchJson('/api/v1/'.$resource.'/'.$item['id'], ['responsible_member_ids' => [$this->two->id]])->assertOk()
                ->assertJsonPath('data.responsible_member_ids', [$this->two->id])->assertJsonPath('data.responsible_member_id', $this->two->id);
        }
    }

    public function test_empty_duplicate_foreign_and_inactive_assignments_are_rejected(): void
    {
        foreach (['events', 'reminders'] as $resource) {
            foreach ([[], [$this->one->id, $this->one->id], [$this->foreign->id]] as $ids) {
                $this->postJson('/api/v1/'.$resource, [...$this->payload($resource), 'responsible_member_ids' => $ids])->assertUnprocessable();
            }
        }
        $this->two->update(['status' => 'LEFT']);
        foreach (['events', 'reminders'] as $resource) {
            $this->postJson('/api/v1/'.$resource, $this->payload($resource))->assertUnprocessable();
        }
        $this->assertDatabaseCount('events', 0);
        $this->assertDatabaseCount('reminders', 0);
    }

    public function test_legacy_single_assignment_still_works_and_foreign_updates_cannot_change_it(): void
    {
        foreach (['events', 'reminders'] as $resource) {
            $payload = $this->payload($resource);
            unset($payload['responsible_member_ids']);
            $item = $this->postJson('/api/v1/'.$resource, [...$payload, 'responsible_member_id' => $this->one->id])->assertCreated()
                ->assertJsonPath('data.responsible_member_ids', [$this->one->id])->json('data');
            $this->patchJson('/api/v1/'.$resource.'/'.$item['id'], ['responsible_member_ids' => [$this->foreign->id]])->assertUnprocessable();
            $this->actingAs($this->foreign->user)->patchJson('/api/v1/'.$resource.'/'.$item['id'], ['responsible_member_ids' => [$this->foreign->id]])->assertForbidden();
            $this->actingAs($this->owner);
        }
    }

    public function test_notifications_include_all_assigned_members_and_reminder_changes_reset_delivery(): void
    {
        $event = $this->postJson('/api/v1/events', $this->payload('events'))->assertCreated()->json('data');
        $model = Event::findOrFail($event['id']);
        TelegramNotificationService::notifyEventReminder($model, $this->one);
        TelegramNotificationService::notifyEventReminder($model, $this->two);
        foreach ([$this->one, $this->two] as $member) {
            $this->assertDatabaseHas('telegram_notifications', ['recipient_member_id' => $member->id, 'notification_type' => 'EVENT_REMINDER']);
        }
        $item = $this->postJson('/api/v1/reminders', $this->payload('reminders'))->assertCreated()->json('data');
        $reminder = Reminder::findOrFail($item['id']);
        $reminder->forceFill(['notification_sent_at' => now()])->saveQuietly();
        $this->patchJson('/api/v1/reminders/'.$item['id'], ['responsible_member_ids' => [$this->one->id]])->assertOk();
        $this->assertNull($reminder->fresh()->notification_sent_at);
        TelegramNotificationService::notifyReminderDue($reminder->fresh());
        foreach ([$this->one, $this->two] as $member) {
            $this->assertDatabaseHas('telegram_notifications', ['recipient_member_id' => $member->id, 'notification_type' => 'REMINDER']);
        }
    }
    public function test_migration_backfills_the_original_responsible_for_both_types(): void
    {
        foreach (['events', 'reminders'] as $resource) {
            $payload = $this->payload($resource);
            unset($payload['responsible_member_ids']);
            $this->postJson('/api/v1/'.$resource, [...$payload, 'responsible_member_id' => $this->one->id])->assertCreated();
        }
        $migration = require database_path('migrations/2026_10_21_000025_add_calendar_responsible_member_ids.php');
        $migration->down();
        $migration->up();
        foreach (['events', 'reminders'] as $resource) {
            $this->getJson('/api/v1/'.$resource)->assertOk()->assertJsonPath('data.0.responsible_member_ids', [$this->one->id]);
        }
    }
    public function test_family_timezone_defaults_and_reminder_status_are_returned_immediately(): void
    {
        $this->getJson('/api/v1/family')->assertOk()->assertJsonPath('data.timezone', 'Europe/Moscow');
        $this->patchJson('/api/v1/family', ['timezone' => 'Asia/Yekaterinburg'])->assertOk()->assertJsonPath('data.name', 'Семья');
        foreach (['events', 'reminders'] as $resource) {
            $this->postJson('/api/v1/'.$resource, $this->payload($resource))->assertCreated()
                ->assertJsonPath('data.status', 'SCHEDULED')->assertJsonPath('data.timezone', 'Asia/Yekaterinburg');
            $this->getJson('/api/v1/'.$resource)->assertOk()->assertJsonPath('data.0.status', 'SCHEDULED');
        }
        $this->patchJson('/api/v1/family', ['timezone' => 'Invalid/Zone'])->assertUnprocessable();
        $this->actingAs($this->two->user)->patchJson('/api/v1/family', ['timezone' => 'UTC'])->assertForbidden();
    }

    public function test_notifications_format_saved_timezone_and_open_the_telegram_mini_app(): void
    {
        $this->travelTo(\Carbon\Carbon::parse('2026-10-21T16:00:00Z'));
        config(['services.telegram.bot_token' => 'test-token', 'app.url' => 'https://teamportal.ru']);
        \Illuminate\Support\Facades\Http::fake(['api.telegram.org/*' => \Illuminate\Support\Facades\Http::response(['ok' => true, 'result' => ['message_id' => 1]], 200)]);
        $data = $this->postJson('/api/v1/reminders', [...$this->payload('reminders'), 'scheduled_at' => '2026-10-21T16:22:00Z'])
            ->assertCreated()->assertJsonPath('data.timezone', 'Europe/Moscow')->assertJsonPath('data.scheduled_at', '2026-10-21T16:22:00.000000Z')->json('data');
        TelegramNotificationService::notifyReminderDue(Reminder::findOrFail($data['id']));
        $job = Queue::pushed(\App\Jobs\TelegramNotificationJob::class)->first(fn ($job) => $job->notificationType === 'REMINDER');
        $this->assertNotNull($job);
        $this->assertStringContainsString('21.10.2026 19:22', $job->text);
        $job->handle();
        \Illuminate\Support\Facades\Http::assertSent(fn ($request) =>
            ($request['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] ?? null) === 'https://teamportal.ru/?section=calendar'
            && !str_contains($request['text'], 'https://teamportal.ru'));
        $event = $this->postJson('/api/v1/events', [...$this->payload('events'), 'start_at' => '2026-10-21T16:22:00Z', 'end_at' => '2026-10-21T17:22:00Z'])
            ->assertCreated()->assertJsonPath('data.start_at', '2026-10-21T16:22:00.000000Z')->json('data');
        TelegramNotificationService::notifyEventReminder(Event::findOrFail($event['id']), $this->one);
        $eventJob = Queue::pushed(\App\Jobs\TelegramNotificationJob::class)->first(fn ($job) => $job->notificationType === 'EVENT_REMINDER');
        $this->assertStringContainsString('21.10.2026 19:22', $eventJob->text);
    }
    public function test_scheduler_uses_absolute_time_with_moscow_application_timezone(): void
    {
        $this->travelTo(\Carbon\Carbon::parse('2026-10-21T16:00:00Z'));
        $due = $this->postJson('/api/v1/reminders', [...$this->payload('reminders'), 'scheduled_at' => '2026-10-21T16:22:00Z'])->assertCreated()->json('data');
        $later = $this->postJson('/api/v1/reminders', [...$this->payload('reminders'), 'scheduled_at' => '2026-10-21T19:22:00Z'])->assertCreated()->json('data');
        $event = $this->postJson('/api/v1/events', [...$this->payload('events'), 'start_at' => '2026-10-21T16:51:30Z', 'end_at' => '2026-10-21T17:51:30Z'])->assertCreated()->json('data');
        Queue::fake();
        $this->travelTo(\Carbon\Carbon::parse('2026-10-21T16:22:00Z'));
        $this->artisan('family:send-reminders')->assertSuccessful();
        $this->assertNotNull(Reminder::findOrFail($due['id'])->notification_sent_at);
        $this->assertNull(Reminder::findOrFail($later['id'])->notification_sent_at);
        $this->artisan('family:send-event-notifications')->assertSuccessful();
        Queue::assertPushed(\App\Jobs\TelegramNotificationJob::class, fn ($job) => $job->notificationType === 'EVENT_REMINDER' && ($job->payload['event_id'] ?? null) === $event['id']);
    }
}
