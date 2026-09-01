<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void { Schema::create('family_members', function(Blueprint $table){ $table->ulid('id')->primary(); $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete(); $table->foreignUlid('user_id')->constrained('users')->cascadeOnDelete(); $table->string('role',32)->default('USER'); $table->string('status',32)->default('ACTIVE'); $table->foreignUlid('invited_by')->nullable()->constrained('users')->nullOnDelete(); $table->timestamp('joined_at')->nullable(); $table->timestamps(); $table->unique(['family_id','user_id']); }); }
 public function down(): void { Schema::dropIfExists('family_members'); }
};
