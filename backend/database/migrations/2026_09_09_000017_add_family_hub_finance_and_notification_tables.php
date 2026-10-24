<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('family_invitations', function (Blueprint $table) {
            $table->unsignedBigInteger('telegram_user_id')->nullable()->change();
        });

        Schema::table('reminders', function (Blueprint $table) {
            if (!Schema::hasColumn('reminders', 'notification_sent_at')) {
                $table->timestamp('notification_sent_at')->nullable()->after('scheduled_at');
            }
        });

        Schema::create('finance_cards', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('bank_name', 120)->nullable();
            $table->string('last4', 4)->nullable();
            $table->string('payment_system', 40)->nullable();
            $table->decimal('default_cashback_rate', 6, 2)->default(0);
            $table->string('status', 32)->default('ACTIVE');
            $table->text('notes')->nullable();
            $table->foreignUlid('created_by')->constrained('users');
            $table->timestamps();
            $table->softDeletes();
            $table->index(['family_id', 'status']);
        });

        Schema::create('cashback_offers', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->foreignUlid('card_id')->nullable()->constrained('finance_cards')->nullOnDelete();
            $table->string('merchant_name', 160)->nullable();
            $table->string('category', 120)->nullable();
            $table->decimal('cashback_rate', 6, 2)->default(0);
            $table->decimal('cap_amount', 14, 2)->nullable();
            $table->date('valid_from')->nullable();
            $table->date('valid_to')->nullable();
            $table->text('notes')->nullable();
            $table->foreignUlid('created_by')->constrained('users');
            $table->timestamps();
            $table->softDeletes();
            $table->index(['family_id', 'valid_from', 'valid_to']);
        });

        Schema::create('receipts', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->foreignUlid('expense_id')->nullable()->constrained('expenses')->nullOnDelete();
            $table->foreignUlid('uploaded_by')->constrained('users');
            $table->string('file_name', 255)->nullable();
            $table->string('mime_type', 80)->nullable();
            $table->longText('image_data')->nullable();
            $table->string('ocr_status', 32)->default('PENDING');
            $table->text('ocr_text')->nullable();
            $table->json('ai_result')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->index(['family_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('receipts');
        Schema::dropIfExists('cashback_offers');
        Schema::dropIfExists('finance_cards');
        Schema::table('reminders', function (Blueprint $table) {
            if (Schema::hasColumn('reminders', 'notification_sent_at')) {
                $table->dropColumn('notification_sent_at');
            }
        });
        Schema::table('family_invitations', function (Blueprint $table) {
            $table->unsignedBigInteger('telegram_user_id')->nullable(false)->change();
        });
    }
};
