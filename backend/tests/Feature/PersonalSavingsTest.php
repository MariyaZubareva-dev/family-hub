<?php

namespace Tests\Feature;

use App\Http\Middleware\TelegramAuthenticate;
use App\Models\{User, Family, FamilyMember, FinanceTransaction};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class PersonalSavingsTest extends TestCase
{
    use RefreshDatabase;
    private User $owner;
    private User $admin;
    private Family $family;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(TelegramAuthenticate::class);
        $this->owner = User::create(['telegram_user_id' => 70101, 'first_name' => 'Мария']);
        $this->admin = User::create(['telegram_user_id' => 70102, 'first_name' => 'Андрей']);
        $this->family = Family::create(['name' => 'Семья', 'created_by' => $this->admin->id]);
        foreach ([[$this->owner, 'USER'], [$this->admin, 'ADMIN']] as [$u, $role]) FamilyMember::create(['family_id' => $this->family->id, 'user_id' => $u->id, 'role' => $role, 'status' => 'ACTIVE']);
        $this->actingAs($this->owner);
    }

    private function pot(array $extra = []): string
    {
        $data = $this->postJson('/api/v1/finance/pots', ['name' => 'Личная цель', 'request_key' => (string) Str::uuid(), ...$extra])->assertCreated()->json('data.pots');
        return collect($data)->last()['id'];
    }

    private function cash(float $amount, string $type = 'INCOME', ?string $date = null): string
    {
        return $this->postJson('/api/v1/finances', ['type' => $type, 'amount' => $amount, 'category' => $type === 'INCOME' ? 'ЗП' : 'Продукты', 'occurred_on' => $date ?? now('Europe/Moscow')->toDateString()])->assertCreated()->json('data.id');
    }

    private function move(string $id, string $kind, float $amount, array $extra = [])
    {
        return $this->postJson("/api/v1/finance/pots/$id/movements", ['kind' => $kind, 'amount' => $amount, 'request_key' => (string) Str::uuid(), ...$extra]);
    }

    public function test_money_carries_over_and_transfers_do_not_inflate_income_or_expenses(): void
    {
        $this->travelTo(now()->setDate(2026, 10, 29)->setTime(12, 0));
        $this->cash(100000, 'INCOME', '2026-09-01');
        $id = $this->pot();
        $this->move($id, 'DEPOSIT', 30000)->assertOk()->assertJsonPath('data.available', 70000);
        $this->move($id, 'WITHDRAW', 5000)->assertOk()->assertJsonPath('data.available', 75000);
        $this->cash(5000, 'EXPENSE');
        $this->getJson('/api/v1/finance/analytics?period=month&year=2026&month=10')->assertOk()->assertJsonPath('data.available_cash', 70000)->assertJsonPath('data.total_income', 0)->assertJsonPath('data.total_expense', 5000);
        $this->getJson('/api/v1/finance/personal')->assertOk()->assertJsonPath('data.pots.0.balance', 25000);
        $this->assertDatabaseCount('finance_transactions', 2);
        $this->travelTo(now()->addMonth());
        $this->getJson('/api/v1/finance/analytics?period=month&year=2026&month=11')->assertJsonPath('data.available_cash', 70000)->assertJsonPath('data.total_expense', 0);
    }

    public function test_even_admin_cannot_read_or_mutate_another_users_pots(): void
    {
        $id = $this->pot(['name' => 'Секретная цель', 'opening_amount' => 100]);
        $this->cash(1000);
        $this->move($id, 'DEPOSIT', 200, ['note' => 'Личная заметка'])->assertOk();
        $this->actingAs($this->admin);
        $this->getJson('/api/v1/finance/personal')->assertOk()->assertJsonCount(0, 'data.pots')->assertJsonCount(0, 'data.history')->assertJsonCount(0, 'data.income');
        $this->patchJson("/api/v1/finance/pots/$id", ['name' => 'Изменено'])->assertNotFound();
        $this->move($id, 'WITHDRAW', 1)->assertNotFound();
        $this->postJson("/api/v1/finance/pots/$id/archive")->assertNotFound();
        $other = $this->pot(['opening_amount' => 50]);
        $this->move($other, 'TRANSFER', 20, ['destination_id' => $id])->assertNotFound();
        $history = $this->getJson('/api/v1/finance/savings-history')->assertOk()->assertJsonCount(1, 'data')->json('data.0');
        $this->assertSame('Мария', $history['first_name']);
        foreach (['pot_id', 'destination_id', 'note', 'name', 'balance'] as $key) $this->assertArrayNotHasKey($key, $history);
        $this->assertArrayNotHasKey('pot_id', $history);
        $this->assertArrayNotHasKey('note', $history);
        $this->assertStringNotContainsString('Секретная цель', json_encode($history, JSON_UNESCAPED_UNICODE));
    }

    public function test_opening_money_does_not_reduce_budget_and_can_be_returned_or_moved(): void
    {
        $a = $this->pot(['opening_amount' => 500]);
        $b = $this->pot();
        $this->getJson('/api/v1/finance/analytics')->assertJsonPath('data.available_cash', 0);
        $this->move($a, 'TRANSFER', 200, ['destination_id' => $b])->assertOk()->assertJsonPath('data.available', 0);
        $this->assertEquals(300, \App\Services\Finance\SavingsLedger::balance($a) / 100);
        $this->move($b, 'WITHDRAW', 200)->assertOk()->assertJsonPath('data.available', 200);
        $this->postJson("/api/v1/finance/pots/$a/archive")->assertUnprocessable();
        $this->postJson("/api/v1/finance/pots/$b/archive")->assertOk();
        $this->move($b, 'DEPOSIT', 1)->assertUnprocessable();
        $this->getJson('/api/v1/finance/savings-history')->assertJsonCount(1, 'data');
        $this->assertDatabaseCount('finance_transactions', 0);
    }

    public function test_invalid_and_repeated_transfers_cannot_overdraw_or_double_spend(): void
    {
        $this->cash(100.01);
        $id = $this->pot();
        $key = (string) Str::uuid();
        $this->move($id, 'DEPOSIT', 100.01, ['request_key' => $key])->assertOk();
        $this->move($id, 'DEPOSIT', 100.01, ['request_key' => $key])->assertOk();
        $this->move($id, 'DEPOSIT', 1)->assertUnprocessable();
        $this->move($id, 'WITHDRAW', 100.02)->assertUnprocessable();
        $this->move($id, 'WITHDRAW', -1)->assertUnprocessable();
        $this->move($id, 'WITHDRAW', 0.001)->assertUnprocessable();
        $this->move($id, 'TRANSFER', 1, ['destination_id' => $id])->assertUnprocessable();
        $this->move($id, 'DEPOSIT', 1, ['request_key' => $key])->assertConflict();
        $this->assertDatabaseCount('savings_movements', 2);
        $this->move($id, 'WITHDRAW', 100.01)->assertOk()->assertJsonPath('data.available', 100.01);
    }

    public function test_income_and_reservation_are_atomic_and_retry_safe(): void
    {
        $id = $this->pot();
        $d = ['type' => 'INCOME', 'amount' => 1000, 'category' => 'ЗП', 'occurred_on' => now('Europe/Moscow')->toDateString(), 'savings_pot_id' => $id, 'savings_amount' => 300, 'request_key' => (string) Str::uuid()];
        $saved = $this->postJson('/api/v1/finances', $d)->assertCreated()->json('data.id');
        $this->postJson('/api/v1/finances', $d)->assertCreated()->assertJsonPath('data.id', $saved);
        $this->assertDatabaseCount('finance_transactions', 1);
        $this->getJson('/api/v1/finance/personal')->assertJsonPath('data.available', 700)->assertJsonPath('data.pots.0.balance', 300);
        $this->actingAs($this->admin)->postJson('/api/v1/finances', [...$d, 'request_key' => (string) Str::uuid()])->assertNotFound();
        $this->assertDatabaseCount('finance_transactions', 1);
        $this->actingAs($this->owner)->patchJson("/api/v1/finances/$saved", ['amount' => 900])->assertOk();
        $this->getJson('/api/v1/finance/personal')->assertJsonPath('data.available', 600)->assertJsonPath('data.pots.0.balance', 300);
    }

    public function test_creation_retry_edit_nullable_goal_and_hidden_section(): void
    {
        $key = (string) Str::uuid();
        $id = $this->pot(['request_key' => $key, 'target_amount' => 1000, 'target_date' => '2027-01-01']);
        $this->pot(['request_key' => $key]);
        $this->assertDatabaseCount('savings_pots', 1);
        $this->patchJson("/api/v1/finance/pots/$id", ['name' => 'Подушка', 'target_amount' => null, 'target_date' => null])->assertOk()->assertJsonPath('data.pots.0.target_amount', null)->assertJsonPath('data.pots.0.target_date', null);
        FamilyMember::where('user_id', $this->owner->id)->update(['section_visibility' => json_encode(['finance' => false])]);
        $this->getJson('/api/v1/finance/personal')->assertForbidden();
        $this->move($id, 'DEPOSIT', 1)->assertForbidden();
    }

    public function test_foreign_family_and_future_income_do_not_fund_pots(): void
    {
        $id = $this->pot();
        $this->cash(1000, 'INCOME', now('Europe/Moscow')->addDay()->toDateString());
        $other = Family::create(['name' => 'Другая', 'created_by' => $this->admin->id]);
        FinanceTransaction::create(['family_id' => $other->id, 'created_by' => $this->admin->id, 'type' => 'INCOME', 'amount' => 5000, 'category' => 'ЗП', 'occurred_on' => today()]);
        $this->getJson('/api/v1/finance/personal')->assertJsonPath('data.available', 0);
        $this->move($id, 'DEPOSIT', 1)->assertUnprocessable();
        $this->cash(50, 'EXPENSE');
        $this->getJson('/api/v1/finance/personal')->assertJsonPath('data.available', -50)->assertJsonPath('data.pots.0.balance', 0);
    }
}
