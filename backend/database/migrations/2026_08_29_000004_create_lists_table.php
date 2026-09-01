<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void { Schema::create('lists', function(Blueprint $table){ $table->ulid('id')->primary(); $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete(); $table->string('name',120); $table->string('type',32)->default('CUSTOM'); $table->foreignUlid('created_by')->constrained('users'); $table->timestamps(); $table->softDeletes(); $table->unique(['family_id','name']); }); }
 public function down(): void { Schema::dropIfExists('lists'); }
};
