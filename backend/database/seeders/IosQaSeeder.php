<?php

namespace Database\Seeders;

use App\Models\Family;
use App\Models\FamilyMember;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class IosQaSeeder extends Seeder
{
    public function run(): void
    {
        if (!app()->environment('local') || !filter_var(env('QA_STAND'), FILTER_VALIDATE_BOOLEAN)
            || config('database.default') !== 'pgsql'
            || config('database.connections.pgsql.database') !== 'family_hub_qa'
            || config('app.url') === 'https://teamportal.ru') {
            throw new RuntimeException('Refusing to seed outside the isolated iOS QA environment.');
        }
        if (User::where('telegram_user_id', 999001)->exists()) return;
        if (User::exists() || Family::exists()) {
            throw new RuntimeException('Unexpected non-empty iOS QA database; refusing to overwrite existing users.');
        }
        DB::transaction(function () {
            $first = User::create(['telegram_user_id' => 999001, 'first_name' => 'Участник QA', 'timezone' => 'Europe/Moscow']);
            User::create(['telegram_user_id' => 999002, 'first_name' => 'Второй участник QA', 'timezone' => 'Europe/Moscow']);
            $family = Family::create(['name' => 'Тестовая семья iOS', 'status' => 'ACTIVE', 'created_by' => $first->id]);
            FamilyMember::create([
                'family_id' => $family->id, 'user_id' => $first->id,
                'role' => 'ADMIN', 'status' => 'ACTIVE', 'joined_at' => now(),
            ]);
        });
    }
}
