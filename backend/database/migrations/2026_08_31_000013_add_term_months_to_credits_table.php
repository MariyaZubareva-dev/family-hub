<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('credits', function (Blueprint $table) {
            $table->unsignedInteger('term_months')->default(360)->after('standard_payment');
        });
    }

    public function down(): void
    {
        Schema::table('credits', function (Blueprint $table) {
            $table->dropColumn('term_months');
        });
    }
};
