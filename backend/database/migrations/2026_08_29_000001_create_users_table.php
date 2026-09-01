<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void { Schema::create('users', function(Blueprint $table){ $table->ulid('id')->primary(); $table->unsignedBigInteger('telegram_user_id')->unique(); $table->string('username')->nullable(); $table->string('first_name'); $table->string('last_name')->nullable(); $table->string('avatar_url')->nullable(); $table->string('timezone',64)->default('Europe/Moscow'); $table->string('locale',16)->nullable(); $table->timestamps(); }); }
 public function down(): void { Schema::dropIfExists('users'); }
};
