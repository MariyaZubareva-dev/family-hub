<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('credit_prepayments', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('credit_id')->constrained('credits')->cascadeOnDelete();
            $table->foreignUlid('created_by')->constrained('users');
            $table->decimal('amount', 14, 2);
            $table->date('paid_on');
            $table->text('comment')->nullable();
            $table->timestamps();
            $table->index(['credit_id', 'paid_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('credit_prepayments');
    }
};
