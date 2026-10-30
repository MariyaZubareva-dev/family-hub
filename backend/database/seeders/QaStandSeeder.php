<?php

namespace Database\Seeders;

use App\Models\{User, Family, FamilyMember, Event, Reminder, FamilyList, ListItem, FinanceTransaction};
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class QaStandSeeder extends Seeder
{
    public function run(): void
    {
        if (!app()->environment('local') || !filter_var(env('QA_STAND'), FILTER_VALIDATE_BOOLEAN)
            || config('database.connections.pgsql.database') !== 'family_hub_qa'
            || config('database.default') !== 'pgsql') {
            throw new \RuntimeException('QA seed requires the isolated local family_hub_qa database.');
        }
        // Do not restore deleted test records or overwrite edits on restart.
        if (DB::table('users')->where('telegram_user_id', 999001)->exists()) return;
        if (User::exists() || Family::exists()) {
            throw new \RuntimeException('Refusing to seed a non-empty, unrecognised database.');
        }
        DB::transaction(function () {
            $anna = User::create(['telegram_user_id' => 999001, 'first_name' => 'Анна (тест)', 'timezone' => 'Europe/Moscow', 'locale' => 'ru']);
            $boris = User::create(['telegram_user_id' => 999002, 'first_name' => 'Борис (тест)', 'timezone' => 'Europe/Moscow', 'locale' => 'ru']);
            $family = Family::create(['name' => 'Тестовая семья', 'status' => 'ACTIVE', 'created_by' => $anna->id]);
            $members = [];
            foreach ([[$anna, 'ADMIN'], [$boris, 'USER']] as [$user, $role]) {
                $members[] = FamilyMember::create(['family_id' => $family->id, 'user_id' => $user->id, 'role' => $role, 'status' => 'ACTIVE', 'joined_at' => now()]);
            }
            $event = Event::create(['family_id' => $family->id, 'created_by' => $anna->id, 'title' => 'Тест: семейная прогулка',
                'start_at' => now()->addDay()->setTime(12, 0), 'end_at' => now()->addDay()->setTime(13, 0),
                'timezone' => 'Europe/Moscow', 'responsible_member_id' => $members[1]->id, 'source' => 'FAMILY_HUB', 'status' => 'SCHEDULED']);
            $event->participants()->sync([$members[0]->id, $members[1]->id]);
            Reminder::create(['family_id' => $family->id, 'created_by' => $anna->id, 'title' => 'Тест: купить корм',
                'scheduled_at' => now()->addDay()->setTime(18, 0), 'responsible_member_id' => $members[1]->id,
                'timezone' => 'Europe/Moscow', 'status' => 'SCHEDULED']);
            $list = FamilyList::create(['family_id' => $family->id, 'name' => 'Тестовый список', 'type' => 'CUSTOM', 'created_by' => $anna->id]);
            ListItem::create(['list_id' => $list->id, 'title' => 'Молоко', 'created_by' => $anna->id, 'is_completed' => false, 'position' => 0]);
            foreach ([[$anna, 'INCOME', 100000], [$boris, 'INCOME', 60000], [$anna, 'EXPENSE', 5000]] as [$user, $type, $amount]) {
                FinanceTransaction::create(['family_id' => $family->id, 'created_by' => $user->id, 'type' => $type,
                    'amount' => $amount, 'category' => $type === 'INCOME' ? 'Зарплата' : 'Продукты',
                    'occurred_on' => now()->toDateString(), 'description' => 'Вымышленная тестовая операция']);
            }
            foreach ([[$anna, 'Отпуск Анны', 10000], [$boris, 'Велосипед Бориса', 7000]] as [$user, $name, $amount]) {
                $pot = (string) Str::ulid();
                DB::table('savings_pots')->insert(['id' => $pot, 'family_id' => $family->id, 'user_id' => $user->id,
                    'name' => $name, 'target_amount' => 50000, 'created_at' => now(), 'updated_at' => now()]);
                DB::table('savings_movements')->insert(['id' => (string) Str::ulid(), 'family_id' => $family->id,
                    'user_id' => $user->id, 'pot_id' => $pot, 'kind' => 'DEPOSIT', 'amount' => $amount,
                    'note' => 'Личная тестовая заметка: ' . $name, 'request_key' => (string) Str::uuid(),
                    'created_at' => now(), 'updated_at' => now()]);
            }
        });
    }
}
