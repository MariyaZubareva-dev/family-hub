<?php

namespace Tests\Feature;

use App\Http\Middleware\TelegramAuthenticate;
use App\Jobs\TelegramNotificationJob;
use App\Models\Family;
use App\Models\FamilyMember;
use App\Models\User;
use App\Services\Notifications\TelegramNotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class FamilySectionVisibilityTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $user;
    private FamilyMember $member;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Http::preventStrayRequests();
        $this->withoutMiddleware(TelegramAuthenticate::class);
        $this->admin = User::create(['telegram_user_id' => 40001, 'first_name' => 'Мария']);
        $this->user = User::create(['telegram_user_id' => 40002, 'first_name' => 'Андрей']);
        $family = Family::create(['name' => 'Наша семья', 'created_by' => $this->admin->id]);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $this->admin->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        $this->member = FamilyMember::create(['family_id' => $family->id, 'user_id' => $this->user->id, 'role' => 'USER', 'status' => 'ACTIVE']);
    }

    public function test_admin_can_hide_a_section_and_other_sections_keep_their_access(): void
    {
        $this->actingAs($this->admin)->patchJson("/api/v1/family/members/{$this->member->id}/visibility", ['visibility' => ['finance' => false]])
            ->assertOk()->assertJsonPath('data.members.1.visibility.finance', false);
        $this->actingAs($this->user)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.family.visibility.finance', false);
        $this->getJson('/api/v1/finance/analytics')->assertForbidden()->assertJsonPath('code', 'SECTION_HIDDEN');
        $this->getJson('/api/v1/credits')->assertForbidden();
        $this->getJson('/api/v1/finances')->assertForbidden();
        $this->postJson('/api/v1/finance/cards', ['name' => 'Hidden card'])->assertForbidden();
        $this->postJson('/api/v1/credits', [])->assertForbidden();
        $this->getJson('/api/v1/events')->assertOk();
        $this->getJson('/api/v1/planned-purchases')->assertOk();
        $this->getJson('/api/v1/family')->assertOk();
    }

    public function test_hidden_calendar_and_shopping_block_read_and_write_routes(): void
    {
        $this->member->update(['section_visibility' => ['calendar' => false, 'shopping' => false]]);
        $this->actingAs($this->user);
        foreach (['events', 'reminders', 'planned-purchases', 'lists'] as $resource) {
            $this->getJson("/api/v1/{$resource}")->assertForbidden()->assertJsonPath('code', 'SECTION_HIDDEN');
            $this->postJson("/api/v1/{$resource}", [])->assertForbidden();
        }
        $this->getJson('/api/v1/credits')->assertOk();
    }

    public function test_access_can_be_restored(): void
    {
        $this->member->update(['section_visibility' => ['finance' => false]]);
        $this->actingAs($this->admin)->patchJson("/api/v1/family/members/{$this->member->id}/visibility", ['visibility' => ['finance' => true]])->assertOk();
        $this->actingAs($this->user)->getJson('/api/v1/credits')->assertOk();
    }

    public function test_member_cannot_grant_self_access_or_change_other_members(): void
    {
        $this->member->update(['section_visibility' => ['finance' => false]]);
        $this->actingAs($this->user)->patchJson("/api/v1/family/members/{$this->member->id}/visibility", ['visibility' => ['finance' => true]])->assertForbidden();
        $this->assertFalse($this->member->fresh()->canViewSection('finance'));
    }

    public function test_admin_of_another_family_cannot_change_visibility(): void
    {
        $other = User::create(['telegram_user_id' => 40003, 'first_name' => 'Другой админ']);
        $family = Family::create(['name' => 'Другая семья', 'created_by' => $other->id]);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $other->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        $this->actingAs($other)->patchJson("/api/v1/family/members/{$this->member->id}/visibility", ['visibility' => ['finance' => false]])->assertForbidden();
        $this->assertTrue($this->member->fresh()->canViewSection('finance'));
    }

    public function test_admin_visibility_cannot_be_restricted(): void
    {
        $adminMember = $this->admin->familyMembers()->firstOrFail();
        $this->actingAs($this->admin)->patchJson("/api/v1/family/members/{$adminMember->id}/visibility", ['visibility' => ['finance' => false]])->assertStatus(422);
        $adminMember->update(['section_visibility' => ['finance' => false]]);
        $this->getJson('/api/v1/credits')->assertOk();
    }

    public function test_visibility_payload_rejects_unknown_sections_and_non_booleans(): void
    {
        $this->actingAs($this->admin)->patchJson("/api/v1/family/members/{$this->member->id}/visibility", ['visibility' => ['other' => false]])->assertStatus(422);
        $this->patchJson("/api/v1/family/members/{$this->member->id}/visibility", ['visibility' => ['finance' => 'sometimes']])->assertStatus(422);
    }

    public function test_new_member_keeps_existing_default_access(): void
    {
        $this->actingAs($this->user)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.family.visibility', ['calendar' => true, 'shopping' => true, 'finance' => true]);
        $this->getJson('/api/v1/events')->assertOk();
        $this->getJson('/api/v1/planned-purchases')->assertOk();
        $this->getJson('/api/v1/credits')->assertOk();
    }

    public function test_hidden_section_does_not_queue_notifications(): void
    {
        $this->member->update(['section_visibility' => ['finance' => false]]);
        TelegramNotificationService::notifyBudgetWarning($this->member->family_id, $this->member->id, 'Продукты', 90, 100, 90);
        Queue::assertNothingPushed();
        $this->assertDatabaseCount('telegram_notifications', 0);
    }

    public function test_already_queued_notification_does_not_send_after_access_is_revoked(): void
    {
        TelegramNotificationService::notifyBudgetWarning($this->member->family_id, $this->member->id, 'Продукты', 90, 100, 90);
        Queue::assertPushed(TelegramNotificationJob::class);
        $job = Queue::pushed(TelegramNotificationJob::class)->first()['job'];
        $this->member->update(['section_visibility' => ['finance' => false]]);
        $job->handle();
        Http::assertNothingSent();
        $this->assertDatabaseHas('telegram_notifications', ['recipient_member_id' => $this->member->id, 'status' => 'FAILED', 'error_code' => 'ACCESS_REVOKED']);
    }
}
