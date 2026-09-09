<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('expense_categories', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('icon', 40)->nullable();
            $table->boolean('is_mandatory')->default(false);
            $table->string('status', 32)->default('ACTIVE');
            $table->foreignUlid('created_by')->constrained('users');
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['family_id', 'name']);
        });

        Schema::create('budgets', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->unsignedSmallInteger('year');
            $table->unsignedTinyInteger('month');
            $table->decimal('total_limit', 14, 2);
            $table->string('status', 32)->default('ACTIVE');
            $table->foreignUlid('created_by')->constrained('users');
            $table->timestamps();
            $table->unique(['family_id', 'year', 'month']);
        });

        Schema::create('budget_categories', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('budget_id')->constrained('budgets')->cascadeOnDelete();
            $table->foreignUlid('category_id')->constrained('expense_categories')->restrictOnDelete();
            $table->decimal('limit_amount', 14, 2);
            $table->timestamps();
            $table->unique(['budget_id', 'category_id']);
        });

        Schema::create('financial_goals', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->string('name', 255);
            $table->string('type', 32);
            $table->decimal('target_amount', 14, 2);
            $table->foreignUlid('category_id')->nullable()->constrained('expense_categories')->nullOnDelete();
            $table->date('target_date')->nullable();
            $table->string('priority', 32)->default('MEDIUM');
            $table->decimal('current_price', 14, 2)->nullable();
            $table->text('url')->nullable();
            $table->text('description')->nullable();
            $table->string('status', 32)->default('PLANNED');
            $table->foreignUlid('created_by')->constrained('users');
            $table->timestamps();
            $table->softDeletes();
            $table->index(['family_id', 'status']);
        });

        Schema::create('incomes', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->decimal('amount', 14, 2);
            $table->char('currency', 3)->default('RUB');
            $table->date('income_date');
            $table->string('source', 255);
            $table->foreignUlid('recipient_member_id')->constrained('family_members')->restrictOnDelete();
            $table->string('status', 32)->default('RECEIVED');
            $table->text('comment')->nullable();
            $table->foreignUlid('budget_id')->nullable()->constrained('budgets')->nullOnDelete();
            $table->foreignUlid('created_by')->constrained('users');
            $table->timestamps();
            $table->softDeletes();
            $table->index(['family_id', 'income_date', 'status']);
        });

        Schema::create('expenses', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->decimal('amount', 14, 2);
            $table->char('currency', 3)->default('RUB');
            $table->date('expense_date');
            $table->foreignUlid('category_id')->constrained('expense_categories')->restrictOnDelete();
            $table->foreignUlid('payer_member_id')->constrained('family_members')->restrictOnDelete();
            $table->string('merchant_name', 255)->nullable();
            $table->text('description')->nullable();
            $table->string('input_method', 32)->default('MANUAL');
            $table->string('status', 32)->default('CONFIRMED');
            $table->foreignUlid('financial_goal_id')->nullable()->constrained('financial_goals')->nullOnDelete();
            $table->foreignUlid('created_by')->constrained('users');
            $table->timestamps();
            $table->softDeletes();
            $table->index(['family_id', 'expense_date', 'status']);
            $table->index(['financial_goal_id']);
        });

        Schema::create('goal_contributions', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('goal_id')->constrained('financial_goals')->cascadeOnDelete();
            $table->decimal('amount', 14, 2);
            $table->date('contribution_date');
            $table->foreignUlid('budget_id')->nullable()->constrained('budgets')->nullOnDelete();
            $table->foreignUlid('created_by')->constrained('users');
            $table->timestamps();
            $table->index(['goal_id', 'contribution_date']);
        });

        Schema::create('goal_price_history', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('goal_id')->constrained('financial_goals')->cascadeOnDelete();
            $table->decimal('price', 14, 2);
            $table->text('url')->nullable();
            $table->text('comment')->nullable();
            $table->timestampTz('recorded_at');
            $table->foreignUlid('created_by')->constrained('users');
            $table->timestamp('created_at')->useCurrent();
            $table->index(['goal_id', 'recorded_at']);
        });

        Schema::create('audit_events', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('entity_type', 120);
            $table->ulid('entity_id');
            $table->string('action', 120);
            $table->json('before_json')->nullable();
            $table->json('after_json')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->index(['family_id', 'created_at']);
            $table->index(['entity_type', 'entity_id']);
        });

        Schema::create('idempotency_records', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->string('key', 255);
            $table->string('operation', 120);
            $table->unsignedSmallInteger('response_status')->nullable();
            $table->json('response_json')->nullable();
            $table->timestamps();
            $table->unique(['family_id', 'key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('idempotency_records');
        Schema::dropIfExists('audit_events');
        Schema::dropIfExists('goal_price_history');
        Schema::dropIfExists('goal_contributions');
        Schema::dropIfExists('expenses');
        Schema::dropIfExists('incomes');
        Schema::dropIfExists('financial_goals');
        Schema::dropIfExists('budget_categories');
        Schema::dropIfExists('budgets');
        Schema::dropIfExists('expense_categories');
    }
};
