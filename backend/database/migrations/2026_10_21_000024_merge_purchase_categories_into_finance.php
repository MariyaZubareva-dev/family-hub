<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        foreach (DB::table('purchase_categories')->join('families', 'families.id', '=', 'purchase_categories.family_id')
            ->select('purchase_categories.family_id', 'purchase_categories.name', 'families.created_by')->cursor() as $category) {
            $name = trim($category->name);
            if ($name === '') continue;
            $exists = DB::table('expense_categories')->where('family_id', $category->family_id)
                ->where('transaction_type', 'EXPENSE')->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])->exists();
            if ($exists) continue;
            DB::table('expense_categories')->insertOrIgnore([
                'id' => (string) Str::ulid(), 'family_id' => $category->family_id,
                'created_by' => $category->created_by, 'name' => $name,
                'transaction_type' => 'EXPENSE', 'status' => 'ACTIVE',
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        // Shared categories may already be used by expenses and budgets; retain them.
    }
};
