<?php

namespace App\Services\Finance;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CategoryCatalog
{
    public const EXPENSE_NAMES = ['Продукты', 'Еда вне дома', 'Транспорт', 'Покупки', 'Развлечения', 'Здоровье', 'Услуги', 'Дом. хоз-во', 'Подарки', 'Кредит', 'Комиссия', 'Квартира', 'Путешествия', 'Одежда', 'Сайты', 'Инвестиции', 'Крипта', 'Образование', 'Автомобиль', 'Мария'];

    public static function ensureDefaults(string $familyId, string $userId): void
    {
        $rows = [];
        foreach (['EXPENSE' => self::EXPENSE_NAMES, 'INCOME' => ['ЗП', 'Премия', 'Другое']] as $type => $names) {
            foreach ($names as $name) {
                $rows[] = ['id' => (string) Str::ulid(), 'family_id' => $familyId, 'created_by' => $userId, 'name' => $name, 'transaction_type' => $type, 'status' => 'ACTIVE', 'created_at' => now(), 'updated_at' => now()];
            }
        }
        DB::table('expense_categories')->insertOrIgnore($rows);
    }
}
