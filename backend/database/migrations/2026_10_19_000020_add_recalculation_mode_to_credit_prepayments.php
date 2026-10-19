<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('credit_prepayments', function (Blueprint $table) {
            $table->string('recalculation_mode', 16)->nullable()->after('paid_on');
        });
    }

    public function down(): void
    {
        Schema::table('credit_prepayments', function (Blueprint $table) {
            $table->dropColumn('recalculation_mode');
        });
    }
};
