<?php

namespace Tests\Feature;

use App\Http\Middleware\TelegramAuthenticate;
use App\Models\Family;
use App\Models\FamilyMember;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FinanceAndFamilyPermissionTest extends TestCase
{
    use RefreshDatabase;

    public function test_last_admin_cannot_be_demoted(): void
    {
        $user = User::create(['telegram_user_id' => 10001, 'first_name' => 'Admin']);
        $family = Family::create(['name' => 'Test family', 'created_by' => $user->id]);
        $member = FamilyMember::create(['family_id' => $family->id, 'user_id' => $user->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);

        $this->withoutMiddleware(TelegramAuthenticate::class)
            ->actingAs($user)
            ->patchJson("/api/v1/family/members/{$member->id}", ['role' => 'USER'])
            ->assertStatus(422);

        $this->assertDatabaseHas('family_members', ['id' => $member->id, 'role' => 'ADMIN']);
    }

    public function test_user_cannot_access_finance_core(): void
    {
        $admin = User::create(['telegram_user_id' => 10002, 'first_name' => 'Admin']);
        $user = User::create(['telegram_user_id' => 10003, 'first_name' => 'User']);
        $family = Family::create(['name' => 'Test family', 'created_by' => $admin->id]);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $admin->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $user->id, 'role' => 'USER', 'status' => 'ACTIVE']);

        $this->withoutMiddleware(TelegramAuthenticate::class)
            ->actingAs($user)
            ->getJson('/api/v1/incomes')
            ->assertForbidden();
    }

    public function test_invitation_moves_from_pending_to_accepted(): void
    {
        $admin = User::create(['telegram_user_id' => 10004, 'first_name' => 'Admin']);
        $invitee = User::create(['telegram_user_id' => 10005, 'first_name' => 'Invitee']);
        $family = Family::create(['name' => 'Test family', 'created_by' => $admin->id]);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $admin->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);

        $headers = ['X-Telegram-Init-Data' => 'not-used'];
        $invitation = $this->withoutMiddleware(TelegramAuthenticate::class)
            ->actingAs($admin)
            ->postJson('/api/v1/family/invitations', ['telegram_user_id' => 10005])
            ->assertCreated()
            ->json('data');

        $this->assertDatabaseHas('family_invitations', ['id' => $invitation['id'], 'status' => 'PENDING']);

        $this->withoutMiddleware(TelegramAuthenticate::class)
            ->actingAs($invitee)
            ->postJson("/api/v1/family/invitations/{$invitation['id']}/accept", [], $headers)
            ->assertOk();

        $this->assertDatabaseHas('family_invitations', ['id' => $invitation['id'], 'status' => 'ACCEPTED']);
        $this->assertDatabaseHas('family_members', ['family_id' => $family->id, 'user_id' => $invitee->id, 'status' => 'ACTIVE']);
    }
}
