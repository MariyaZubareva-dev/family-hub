<?php

namespace Tests\Feature;

use App\Http\Middleware\TelegramAuthenticate;
use App\Models\Family;
use App\Models\FamilyMember;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlannedPurchaseApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_recurring_purchase_is_shared_and_rescheduled_after_purchase(): void
    {
        $admin = User::create(['telegram_user_id' => 30101, 'first_name' => 'Admin']);
        $memberUser = User::create(['telegram_user_id' => 30102, 'first_name' => 'Member']);
        $family = Family::create(['name' => 'Family', 'created_by' => $admin->id]);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $admin->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $memberUser->id, 'role' => 'USER', 'status' => 'ACTIVE']);

        $purchase = $this->withoutMiddleware(TelegramAuthenticate::class)
            ->actingAs($admin)
            ->postJson('/api/v1/planned-purchases', [
                'type' => 'RECURRING',
                'name' => 'Шампунь',
                'due_date' => '2026-03-31',
                'cadence_months' => 3,
            ])
            ->assertCreated()
            ->json('data');

        $this->actingAs($memberUser)
            ->getJson('/api/v1/planned-purchases')
            ->assertOk()
            ->assertJsonPath('data.0.id', $purchase['id']);

        $this->actingAs($admin)
            ->postJson("/api/v1/planned-purchases/{$purchase['id']}/purchased", ['purchased_on' => '2026-03-31'])
            ->assertOk()
            ->assertJsonPath('data.due_date', '2026-06-30')
            ->assertJsonPath('data.last_purchased_at', '2026-03-31');
    }

    public function test_recurring_purchase_requires_due_date_and_cadence(): void
    {
        $user = User::create(['telegram_user_id' => 30103, 'first_name' => 'Admin']);
        $family = Family::create(['name' => 'Family', 'created_by' => $user->id]);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $user->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);

        $this->withoutMiddleware(TelegramAuthenticate::class)
            ->actingAs($user)
            ->postJson('/api/v1/planned-purchases', ['type' => 'RECURRING', 'name' => 'Шампунь'])
            ->assertStatus(422);
    }
}
