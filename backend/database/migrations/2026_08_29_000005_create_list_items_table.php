<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void { Schema::create('list_items', function(Blueprint $table){ $table->ulid('id')->primary(); $table->foreignUlid('list_id')->constrained('lists')->cascadeOnDelete(); $table->string('title',255); $table->boolean('is_completed')->default(false); $table->foreignUlid('created_by')->constrained('users'); $table->foreignUlid('completed_by')->nullable()->constrained('users')->nullOnDelete(); $table->timestamp('completed_at')->nullable(); $table->unsignedInteger('position')->default(0); $table->timestamps(); $table->softDeletes(); $table->index(['list_id','is_completed']); }); }
 public function down(): void { Schema::dropIfExists('list_items'); }
};
