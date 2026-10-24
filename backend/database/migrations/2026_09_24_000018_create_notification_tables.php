<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('failed_jobs')) {
            Schema::create('failed_jobs', function (Blueprint $table) {
                $table->id();
                $table->string('uuid')->unique();
                $table->text('connection');
                $table->text('queue');
                $table->longText('payload');
                $table->longText('exception');
                $table->timestamp('failed_at')->useCurrent();
            });
        }

        if (!Schema::hasTable('job_batches')) {
            Schema::create('job_batches', function (Blueprint $table) {
                $table->string('id')->primary();
                $table->string('name');
                $table->integer('total_jobs');
                $table->integer('pending_jobs');
                $table->integer('failed_jobs');
                $table->longText('failed_job_ids');
                $table->mediumText('options')->nullable();
                $table->integer('cancelled_at')->nullable();
                $table->integer('created_at');
                $table->integer('finished_at')->nullable();
            });
        }

        if (!Schema::hasTable('reminder_notifications')) {
            Schema::create('reminder_notifications', function (Blueprint $table) {
                $table->ulid('id')->primary();
                $table->foreignUlid('reminder_id')->constrained('reminders')->cascadeOnDelete();
                $table->foreignUlid('recipient_member_id')->constrained('family_members')->cascadeOnDelete();
                $table->string('notification_type', 32); // REMINDER, EVENT_REMINDER etc
                $table->timestampTz('scheduled_at');
                $table->timestampTz('sent_at')->nullable();
                $table->string('status', 32)->default('PENDING'); // PENDING, SENT, FAILED
                $table->bigInteger('telegram_message_id')->nullable();
                $table->string('error_code', 64)->nullable();
                $table->text('error_message')->nullable();
                $table->timestamps();
                $table->unique(['reminder_id', 'scheduled_at', 'notification_type'], 'reminder_sched_type_unique');
                $table->index(['status', 'scheduled_at']);
            });
        }

        if (!Schema::hasTable('telegram_notifications')) {
            Schema::create('telegram_notifications', function (Blueprint $table) {
                $table->ulid('id')->primary();
                $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
                $table->string('notification_type', 32); // EVENT_REMINDER, REMINDER, EVENT_CHANGED, EVENT_CANCELLED, AI_READY_FOR_REVIEW, BUDGET_WARNING
                $table->ulid('notifiable_id')->nullable();
                $table->string('notifiable_type', 120)->nullable();
                $table->foreignUlid('recipient_member_id')->constrained('family_members')->cascadeOnDelete();
                $table->json('payload')->nullable();
                $table->string('idempotency_key', 255);
                $table->timestampTz('scheduled_at');
                $table->timestampTz('sent_at')->nullable();
                $table->string('status', 32)->default('PENDING'); // PENDING, SENT, FAILED
                $table->bigInteger('telegram_message_id')->nullable();
                $table->string('error_code', 64)->nullable();
                $table->text('error_message')->nullable();
                $table->timestamps();
                $table->unique(['family_id', 'idempotency_key']);
                $table->index(['status', 'scheduled_at']);
                $table->index(['notification_type']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('telegram_notifications');
        Schema::dropIfExists('reminder_notifications');
        Schema::dropIfExists('job_batches');
        Schema::dropIfExists('failed_jobs');
    }
};
