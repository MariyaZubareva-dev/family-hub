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
}
