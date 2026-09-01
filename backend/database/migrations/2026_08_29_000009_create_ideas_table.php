<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void { Schema::create('ideas', function(Blueprint $table){ $table->ulid('id')->primary(); $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete(); $table->foreignUlid('created_by')->constrained('users'); $table->string('title',255); $table->text('description')->nullable(); $table->string('status',32)->default('OPEN'); $table->timestamps(); $table->softDeletes(); $table->index(['family_id','status']); }); }
 public function down(): void { Schema::dropIfExists('ideas'); }
};
