<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // receipts: confirmed_at + review_payload
        Schema::table('receipts', function (Blueprint $table) {
            if (!Schema::hasColumn('receipts', 'confirmed_at')) {
                $table->timestamp('confirmed_at')->nullable()->after('ocr_text');
            }
            if (!Schema::hasColumn('receipts', 'review_payload')) {
                $table->json('review_payload')->nullable()->after('ai_result');
            }
        });

        // finance_transactions: category_id + receipt_id (add if not exists)
        Schema::table('finance_transactions', function (Blueprint $table) {
            if (!Schema::hasColumn('finance_transactions', 'category_id')) {
                $table->ulid('category_id')->nullable()->after('category');
                $table->index(['family_id','category_id']);
                // FK optional — don't hard-fail if expense_categories not yet migrated
                // $table->foreign('category_id')->references('id')->on('expense_categories')->nullOnDelete();
            }
            if (!Schema::hasColumn('finance_transactions', 'receipt_id')) {
                $table->ulid('receipt_id')->nullable()->after('category_id');
                $table->index(['receipt_id']);
                // $table->foreign('receipt_id')->references('id')->on('receipts')->nullOnDelete();
            }
            if (!Schema::hasColumn('finance_transactions', 'description')) {
                $table->string('description', 255)->nullable()->after('amount');
            }
        });

        // finance_transactions may be named 'finances' in some installs — handle both
        if (Schema::hasTable('finances') && !Schema::hasColumn('finances', 'receipt_id')) {
            Schema::table('finances', function (Blueprint $table) {
                $table->ulid('receipt_id')->nullable()->after('category');
                $table->index(['receipt_id']);
            });
        }
        if (Schema::hasTable('finances') && !Schema::hasColumn('finances', 'category_id')) {
            Schema::table('finances', function (Blueprint $table) {
                $table->ulid('category_id')->nullable()->after('category');
                $table->index(['family_id','category_id']);
            });
        }
    }

    public function down(): void
    {
        Schema::table('receipts', function (Blueprint $table) {
            if (Schema::hasColumn('receipts', 'confirmed_at')) $table->dropColumn('confirmed_at');
            if (Schema::hasColumn('receipts', 'review_payload')) $table->dropColumn('review_payload');
        });
        Schema::table('finance_transactions', function (Blueprint $table) {
            if (Schema::hasColumn('finance_transactions', 'receipt_id')) $table->dropColumn('receipt_id');
            if (Schema::hasColumn('finance_transactions', 'category_id')) $table->dropColumn('category_id');
        });
        if (Schema::hasTable('finances')) {
            Schema::table('finances', function (Blueprint $table) {
                if (Schema::hasColumn('finances', 'receipt_id')) $table->dropColumn('receipt_id');
                if (Schema::hasColumn('finances', 'category_id')) $table->dropColumn('category_id');
            });
        }
    }
};
