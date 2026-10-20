<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('credits', fn (Blueprint $table) => $table->string('type', 16)->default('CREDIT'));
        Schema::table('expense_categories', function (Blueprint $table) {
            $table->string('transaction_type', 16)->default('EXPENSE');
            $table->dropUnique(['family_id', 'name']);
            $table->unique(['family_id', 'transaction_type', 'name'], 'finance_categories_family_type_name_unique');
        });
    }

    public function down(): void
    {
        // Category names may repeat across types; retain the schema to avoid deleting financial data.
        throw new \RuntimeException('Откат требует предварительно объединить одноимённые категории доходов и расходов.');
    }
};
