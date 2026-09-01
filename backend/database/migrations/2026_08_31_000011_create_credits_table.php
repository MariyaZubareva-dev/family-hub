<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('credits', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->foreignUlid('created_by')->constrained('users');
            $table->string('name', 120)->default('Кредит');
            $table->decimal('principal', 14, 2);
            $table->decimal('annual_rate', 8, 4);
            $table->decimal('standard_payment', 14, 2);
            $table->date('start_date');
            $table->date('first_payment_date');
            $table->string('recalculation_mode', 16)->default('TERM');
            $table->string('status', 16)->default('ACTIVE');
            $table->timestamps();
            $table->index(['family_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('credits');
    }
};
