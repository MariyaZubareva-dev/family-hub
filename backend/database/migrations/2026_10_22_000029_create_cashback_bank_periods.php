<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('cashback_bank_periods', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->foreignUlid('created_by')->constrained('users');
            $table->string('bank_name', 100);
            $table->string('bank_key', 100);
            $table->string('month', 7);
            $table->jsonb('entries');
            $table->unsignedInteger('revision')->default(1);
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['family_id','created_by','bank_key','month'], 'cashback_owner_bank_month');
            $table->index(['family_id','month']);
        });
    }
    public function down(): void { Schema::dropIfExists('cashback_bank_periods'); }
};
