<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('planned_purchases', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->foreignUlid('created_by')->constrained('users');
            $table->string('type', 24); // LARGE or RECURRING
            $table->string('name', 255);
            $table->string('category', 120)->nullable();
            $table->decimal('estimated_amount', 14, 2)->nullable();
            $table->date('due_date')->nullable();
            $table->unsignedSmallInteger('cadence_months')->nullable();
            $table->date('last_purchased_at')->nullable();
            $table->unsignedTinyInteger('notify_days_before')->default(7);
            $table->string('status', 24)->default('ACTIVE');
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->index(['family_id', 'type', 'status', 'due_date'], 'planned_purchases_family_due_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('planned_purchases');
    }
};
