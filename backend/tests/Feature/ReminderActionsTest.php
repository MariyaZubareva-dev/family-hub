<?php

namespace Tests\Feature;

use App\Http\Middleware\TelegramAuthenticate;
use App\Jobs\TelegramNotificationJob;
use App\Models\{Family, FamilyMember, Reminder, User};
use App\Services\Notifications\TelegramNotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{Http, Queue};
use Tests\TestCase;

class ReminderActionsTest extends TestCase
{
    use RefreshDatabase;

    private FamilyMember $owner;
    private FamilyMember $assigned;
    private FamilyMember $reader;
    private Reminder $reminder;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Http::fake(['api.telegram.org/*' => Http::response(['ok' => true, 'result' => ['message_id' => 42]])]);
        config(['services.telegram.bot_token' => 'test-token']);
        $this->travelTo(\Carbon\Carbon::parse('2026-10-29T10:00:00Z'));
        $user = User::create(['telegram_user_id' => 70101, 'first_name' => 'Автор']);
        $family = Family::create(['name' => 'Family', 'created_by' => $user->id]);
        $this->owner = FamilyMember::create(['family_id' => $family->id, 'user_id' => $user->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        $this->assigned = $this->member($family, 70102);
        $this->reader = $this->member($family, 70103);
        $this->withoutMiddleware(TelegramAuthenticate::class)->actingAs($user);
        $data = $this->postJson('/api/v1/reminders', ['title' => 'Забрать заказ', 'description' => 'Паспорт',
            'responsible_member_ids' => [$this->assigned->id], 'scheduled_at' => '2026-10-29T10:01:00Z'])
            ->assertCreated()->assertJsonPath('data.can_edit', true)->assertJsonPath('data.can_complete', true)->json('data');
        $this->reminder = Reminder::findOrFail($data['id']);
    }

    private function member(Family $family, int $telegram): FamilyMember
    {
        $user = User::create(['telegram_user_id' => $telegram, 'first_name' => 'Участник']);
        return FamilyMember::create(['family_id' => $family->id, 'user_id' => $user->id, 'role' => 'USER', 'status' => 'ACTIVE']);
    }

    private function url(): string { return '/api/v1/reminders/'.$this->reminder->id; }

    public function test_author_can_edit_clear_description_complete_restore_and_delete(): void
    {
        $this->owner->update(['role' => 'USER']);
        $this->patchJson($this->url(), ['title' => 'Другое дело', 'description' => null, 'scheduled_at' => '2026-10-30T12:00:00Z'])
            ->assertOk()->assertJsonPath('data.description', null)->assertJsonPath('data.title', 'Другое дело');
        $this->patchJson($this->url(), ['status' => 'COMPLETED'])->assertOk()->assertJsonPath('data.status', 'COMPLETED');
        $this->getJson('/api/v1/reminders')->assertOk()->assertJsonPath('data.0.status', 'COMPLETED');
        $this->patchJson($this->url(), ['status' => 'SCHEDULED'])->assertOk()->assertJsonPath('data.status', 'SCHEDULED');
        $this->patchJson($this->url(), ['title' => ''])->assertUnprocessable();
        $this->deleteJson($this->url())->assertNoContent();
        $this->getJson('/api/v1/reminders')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson($this->url(), ['status' => 'SCHEDULED'])->assertNotFound();
    }

    public function test_assignee_can_only_toggle_and_other_readers_cannot_mutate(): void
    {
        $this->actingAs($this->assigned->user)->getJson('/api/v1/reminders')->assertOk()
            ->assertJsonPath('data.0.can_edit', false)->assertJsonPath('data.0.can_complete', true);
        $this->patchJson($this->url(), ['status' => 'COMPLETED'])->assertOk();
        $this->patchJson($this->url(), ['status' => 'SCHEDULED'])->assertOk();
        $this->patchJson($this->url(), ['status' => 'COMPLETED', 'title' => 'Чужое изменение'])->assertForbidden();
        $this->patchJson($this->url(), ['status' => 'CANCELLED'])->assertForbidden();
        $this->deleteJson($this->url())->assertForbidden();
        $this->actingAs($this->reader->user)->getJson('/api/v1/reminders')->assertOk()
            ->assertJsonPath('data.0.can_edit', false)->assertJsonPath('data.0.can_complete', false);
        $this->patchJson($this->url(), ['status' => 'COMPLETED'])->assertForbidden();
        $this->reader->update(['role' => 'ADMIN']);
        $this->patchJson($this->url(), ['title' => 'Правка администратора'])->assertOk();
    }

    public function test_foreign_and_hidden_calendar_cannot_mutate(): void
    {
        $family = Family::create(['name' => 'Other', 'created_by' => $this->reader->user_id]);
        $foreign = $this->member($family, 70104);
        $this->actingAs($foreign->user)->patchJson($this->url(), ['status' => 'COMPLETED'])->assertForbidden();
        $this->deleteJson($this->url())->assertForbidden();
        $this->assigned->update(['section_visibility' => ['calendar' => false]]);
        $this->actingAs($this->assigned->user)->patchJson($this->url(), ['status' => 'COMPLETED'])->assertForbidden();
    }

    public function test_queued_reminders_are_suppressed_after_completion_deletion_and_rescheduling(): void
    {
        foreach (['complete', 'delete', 'reschedule'] as $action) {
            Queue::fake();
            $item = $this->reminder->replicate();
            $item->save();
            TelegramNotificationService::notifyReminderDue($item);
            $jobs = Queue::pushed(TelegramNotificationJob::class);
            $this->assertNotEmpty($jobs);
            if ($action === 'complete') $item->update(['status' => 'COMPLETED']);
            if ($action === 'delete') $item->delete();
            if ($action === 'reschedule') $item->update(['scheduled_at' => now()->addDay()]);
            foreach ($jobs as $job) $job->handle();
        }
        Http::assertNothingSent();
    }

    public function test_pending_notification_uses_edited_text_and_restoring_does_not_resend_cancelled_jobs(): void
    {
        TelegramNotificationService::notifyReminderDue($this->reminder);
        $jobs = Queue::pushed(TelegramNotificationJob::class);
        $this->patchJson($this->url(), ['title' => 'Новое название', 'description' => null])->assertOk();
        $jobs->first()->handle();
        Http::assertSent(fn ($r) => str_contains($r['text'], 'Новое название') && !str_contains($r['text'], 'Паспорт'));
        $this->patchJson($this->url(), ['status' => 'COMPLETED'])->assertOk();
        $this->patchJson($this->url(), ['status' => 'SCHEDULED'])->assertOk();
        foreach ($jobs as $job) $job->handle();
        Http::assertSentCount(1);
    }

    public function test_undo_before_due_time_restores_only_undelivered_notifications(): void
    {
        TelegramNotificationService::notifyReminderDue($this->reminder);
        $oldJobs = Queue::pushed(TelegramNotificationJob::class);
        $oldJobs->first()->handle();
        $this->reminder->forceFill(['notification_sent_at' => now()])->saveQuietly();
        $this->patchJson($this->url(), ['status' => 'COMPLETED'])->assertOk();
        $this->patchJson($this->url(), ['status' => 'SCHEDULED'])->assertOk();
        $this->assertNull($this->reminder->fresh()->notification_sent_at);
        Queue::fake();
        $this->artisan('family:send-reminders')->assertSuccessful();
        Queue::assertPushed(TelegramNotificationJob::class, 2);
        foreach ($oldJobs as $job) $job->handle();
        foreach (Queue::pushed(TelegramNotificationJob::class) as $job) $job->handle();
        Http::assertSentCount(3);
    }

    public function test_scheduler_skips_completed_and_sends_rescheduled_reminder_once(): void
    {
        $this->patchJson($this->url(), ['status' => 'COMPLETED'])->assertOk();
        Queue::fake();
        $this->artisan('family:send-reminders')->assertSuccessful();
        Queue::assertNothingPushed();
        $this->patchJson($this->url(), ['status' => 'SCHEDULED', 'scheduled_at' => '2026-10-30T10:00:00Z'])->assertOk();
        $this->travelTo(\Carbon\Carbon::parse('2026-10-30T10:00:00Z'));
        $this->artisan('family:send-reminders')->assertSuccessful();
        $this->artisan('family:send-reminders')->assertSuccessful();
        Queue::assertPushed(TelegramNotificationJob::class, 3);
    }
}
