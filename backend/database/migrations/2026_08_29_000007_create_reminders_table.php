<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void { Schema::create('reminders', function(Blueprint $table){ $table->ulid('id')->primary(); $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete(); $table->foreignUlid('created_by')->constrained('users'); $table->string('title',255); $table->text('description')->nullable(); $table->timestampTz('scheduled_at'); $table->string('timezone',64)->default('Europe/Moscow'); $table->foreignUlid('responsible_member_id')->constrained('family_members'); $table->string('status',32)->default('SCHEDULED'); $table->string('recurrence_rule',255)->nullable(); $table->timestamps(); $table->index(['family_id','scheduled_at']); }); }
 public function down(): void { Schema::dropIfExists('reminders'); }
};
