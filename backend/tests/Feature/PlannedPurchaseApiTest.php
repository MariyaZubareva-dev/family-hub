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
    public function test_purchase_categories_use_finance_expenses_and_admin_creation(): void
    {
        $admin = User::create(['telegram_user_id' => 30104, 'first_name' => 'Admin']);
        $user = User::create(['telegram_user_id' => 30105, 'first_name' => 'Member']);
        $family = Family::create(['name' => 'Family', 'created_by' => $admin->id]);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $admin->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $user->id, 'role' => 'USER', 'status' => 'ACTIVE']);
        $this->withoutMiddleware(TelegramAuthenticate::class)->actingAs($admin)
            ->postJson('/api/v1/finance/categories', ['name' => 'Участок', 'transaction_type' => 'EXPENSE'])->assertCreated();
        $this->postJson('/api/v1/finance/categories', ['name' => 'Особый доход', 'transaction_type' => 'INCOME'])->assertCreated();
        $names = $this->actingAs($user)->getJson('/api/v1/planned-purchases/categories')->assertOk()->json('data');
        $this->assertContains('Участок', array_column($names, 'name'));
        $this->assertNotContains('Особый доход', array_column($names, 'name'));
        $this->postJson('/api/v1/planned-purchases/categories', ['name' => 'Закрыто'])->assertForbidden();
        $category = $this->actingAs($admin)->postJson('/api/v1/planned-purchases/categories', ['name' => '  Для дома  '])
            ->assertCreated()->assertJsonPath('data.transaction_type', 'EXPENSE')->json('data');
        $finance = $this->getJson('/api/v1/finance/categories')->assertOk()->json('data');
        $this->assertContains($category['id'], array_column($finance, 'id'));
        $this->postJson('/api/v1/planned-purchases/categories', ['name' => 'для ДОМА'])->assertUnprocessable();
        $this->postJson('/api/v1/planned-purchases/categories', ['name' => str_repeat('а', 81)])->assertUnprocessable();
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
            ->postJson('/api/v1/planned-purchases/categories', ['name' => 'Только в первой семье'])->assertCreated();
        $names = $this->actingAs($second)->getJson('/api/v1/planned-purchases/categories')->assertOk()->json('data');
        $this->assertNotContains('Только в первой семье', array_column($names, 'name'));
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
        $merge = require database_path('migrations/2026_10_21_000024_merge_purchase_categories_into_finance.php');
        $merge->up();
        $merge->up();
        $categories = $this->getJson('/api/v1/planned-purchases/categories')->assertOk()->json('data');
        $this->assertContains('Участок', array_column($categories, 'name'));
        $this->assertDatabaseCount('purchase_categories', 1);
        $this->assertSame(1, \App\Models\ExpenseCategory::where('family_id', $family->id)->where('name', 'Участок')->count());
        $this->getJson('/api/v1/planned-purchases')->assertOk()->assertJsonPath('data.0.category', '  Участок  ');
    }
}
