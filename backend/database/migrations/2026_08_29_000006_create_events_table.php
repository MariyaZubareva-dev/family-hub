<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void {
  Schema::create('events', function(Blueprint $table){ $table->ulid('id')->primary(); $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete(); $table->foreignUlid('created_by')->constrained('users'); $table->string('title',255); $table->text('description')->nullable(); $table->timestampTz('start_at'); $table->timestampTz('end_at'); $table->string('timezone',64)->default('Europe/Moscow'); $table->string('location',255)->nullable(); $table->foreignUlid('responsible_member_id')->constrained('family_members'); $table->string('source',32)->default('FAMILY_HUB'); $table->string('status',32)->default('SCHEDULED'); $table->string('recurrence_rule',255)->nullable(); $table->timestamps(); $table->softDeletes(); $table->index(['family_id','start_at']); });
  Schema::create('event_participants', function(Blueprint $table){ $table->foreignUlid('event_id')->constrained('events')->cascadeOnDelete(); $table->foreignUlid('family_member_id')->constrained('family_members')->cascadeOnDelete(); $table->timestamps(); $table->primary(['event_id','family_member_id']); });
 }
 public function down(): void { Schema::dropIfExists('event_participants'); Schema::dropIfExists('events'); }
};
