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
    public function test_purchase_categories_are_shared_persistent_and_case_insensitive(): void
    {
        $admin = User::create(['telegram_user_id' => 30104, 'first_name' => 'Admin']);
        $user = User::create(['telegram_user_id' => 30105, 'first_name' => 'Member']);
        $family = Family::create(['name' => 'Family', 'created_by' => $admin->id]);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $admin->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $user->id, 'role' => 'USER', 'status' => 'ACTIVE']);
        $category = $this->withoutMiddleware(TelegramAuthenticate::class)->actingAs($user)
            ->postJson('/api/v1/planned-purchases/categories', ['name' => '  Для дома  '])
            ->assertCreated()->assertJsonPath('data.name', 'Для дома')->json('data');
        $this->actingAs($admin)->postJson('/api/v1/planned-purchases/categories', ['name' => 'для ДОМА'])
            ->assertOk()->assertJsonPath('data.id', $category['id']);
        $this->getJson('/api/v1/planned-purchases/categories')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Для дома');
        $this->postJson('/api/v1/planned-purchases', ['type' => 'LARGE', 'name' => 'Забор', 'category' => 'Для дома'])
            ->assertCreated()->assertJsonPath('data.category', 'Для дома');
        $this->postJson('/api/v1/planned-purchases/categories', ['name' => '   '])->assertUnprocessable();
        $this->postJson('/api/v1/planned-purchases/categories', ['name' => str_repeat('а', 121)])->assertUnprocessable();
    }

    public function test_categories_are_isolated_between_families_and_respect_shopping_visibility(): void
    {
        $first = User::create(['telegram_user_id' => 30106, 'first_name' => 'First']);
        $second = User::create(['telegram_user_id' => 30107, 'first_name' => 'Second']);
        $a = Family::create(['name' => 'A', 'created_by' => $first->id]);
        $b = Family::create(['name' => 'B', 'created_by' => $second->id]);
        FamilyMember::create(['family_id' => $a->id, 'user_id' => $first->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        $member = FamilyMember::create(['family_id' => $b->id, 'user_id' => $second->id, 'role' => 'USER', 'status' => 'ACTIVE']);
        $this->withoutMiddleware(TelegramAuthenticate::class)->actingAs($first)
            ->postJson('/api/v1/planned-purchases/categories', ['name' => 'Подарки'])->assertCreated();
        $this->actingAs($second)->getJson('/api/v1/planned-purchases/categories')->assertOk()->assertJsonCount(0, 'data');
        $this->postJson('/api/v1/planned-purchases/categories', ['name' => 'Подарки'])->assertCreated();
        $member->update(['section_visibility' => ['shopping' => false]]);
        $this->getJson('/api/v1/planned-purchases/categories')->assertForbidden();
        $this->postJson('/api/v1/planned-purchases/categories', ['name' => 'Закрыто'])->assertForbidden();
    }

    public function test_migration_keeps_existing_purchase_categories(): void
    {
        $user = User::create(['telegram_user_id' => 30108, 'first_name' => 'Owner']);
        $family = Family::create(['name' => 'Family', 'created_by' => $user->id]);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $user->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        $this->withoutMiddleware(TelegramAuthenticate::class)->actingAs($user)
            ->postJson('/api/v1/planned-purchases', ['type' => 'LARGE', 'name' => 'Забор', 'category' => '  Участок  '])->assertCreated();
        \Illuminate\Support\Facades\DB::table('planned_purchases')->where('family_id', $family->id)->update(['category' => '  Участок  ']);
        \Illuminate\Support\Facades\Schema::drop('purchase_categories');
        $migration = require database_path('migrations/2026_10_21_000023_create_purchase_categories_table.php');
        $migration->up();
        $this->getJson('/api/v1/planned-purchases/categories')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Участок');
        $this->getJson('/api/v1/planned-purchases')->assertOk()->assertJsonPath('data.0.category', '  Участок  ');
    }
}
