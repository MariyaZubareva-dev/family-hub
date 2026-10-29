<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('savings_pots', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->foreignUlid('family_id')->constrained()->cascadeOnDelete();
            $t->foreignUlid('user_id')->constrained()->restrictOnDelete();
            $t->string('name', 80);
            $t->decimal('target_amount', 12, 2)->nullable();
            $t->date('target_date')->nullable();
            $t->timestamp('archived_at')->nullable();
            $t->timestamps();
            $t->index(['family_id', 'user_id']);
        });
        Schema::create('savings_movements', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->foreignUlid('family_id')->constrained()->cascadeOnDelete();
            $t->foreignUlid('user_id')->constrained()->restrictOnDelete();
            $t->foreignUlid('pot_id')->constrained('savings_pots')->restrictOnDelete();
            $t->foreignUlid('destination_id')->nullable()->constrained('savings_pots')->restrictOnDelete();
            $t->string('kind', 16); // OPENING, DEPOSIT, WITHDRAW, TRANSFER
            $t->decimal('amount', 12, 2);
            $t->string('note', 255)->nullable();
            $t->uuid('request_key');
            $t->timestamps();
            $t->unique(['family_id', 'request_key']);
        });
        Schema::table('finance_transactions', function (Blueprint $t) {
            $t->uuid('request_key')->nullable();
            $t->unique(['family_id', 'request_key']);
        });
    }

    public function down(): void
    {
        Schema::table('finance_transactions', function (Blueprint $t) {
            $t->dropUnique(['family_id', 'request_key']);
            $t->dropColumn('request_key');
        });
        Schema::dropIfExists('savings_movements');
        Schema::dropIfExists('savings_pots');
    }
};
