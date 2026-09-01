<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void { Schema::create('notes', function(Blueprint $table){ $table->ulid('id')->primary(); $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete(); $table->foreignUlid('created_by')->constrained('users'); $table->string('title',255); $table->text('body'); $table->timestamps(); $table->softDeletes(); $table->index(['family_id','created_by']); }); }
 public function down(): void { Schema::dropIfExists('notes'); }
};
