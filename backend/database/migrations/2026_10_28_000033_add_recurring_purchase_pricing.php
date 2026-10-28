<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('planned_purchases', function (Blueprint $table) {
            $table->unsignedInteger('quantity')->default(1);
            $table->decimal('unit_price', 14, 2)->nullable();
        });
        // Existing totals represent one unit until the user sets a quantity.
        DB::table('planned_purchases')->where('type', 'RECURRING')
            ->update(['unit_price' => DB::raw('estimated_amount')]);
    }

    public function down(): void
    {
        Schema::table('planned_purchases', fn (Blueprint $table) => $table->dropColumn(['quantity', 'unit_price']));
    }
};
