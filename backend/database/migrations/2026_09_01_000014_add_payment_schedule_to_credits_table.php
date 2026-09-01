<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('credits', function (Blueprint $table) {
            $table->json('payment_schedule')->nullable()->after('term_months');
        });
    }

    public function down(): void
    {
        Schema::table('credits', function (Blueprint $table) {
            $table->dropColumn('payment_schedule');
        });
    }
};
