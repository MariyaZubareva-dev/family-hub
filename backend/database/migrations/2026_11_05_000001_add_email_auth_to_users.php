<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::table('users', function (Blueprint $table) {
            $table->unsignedBigInteger('telegram_user_id')->nullable()->change();
            $table->string('email')->nullable()->unique();
            $table->string('password')->nullable();
            $table->timestamp('email_verified_at')->nullable();
        });
        Schema::create('browser_sessions', function (Blueprint $table) {
            $table->string('token_hash', 64)->primary();
            $table->ulid('user_id')->index();
            $table->string('csrf_hash', 64);
            $table->timestamp('expires_at')->index();
            $table->timestamps();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });
        Schema::create('email_verification_codes', function (Blueprint $table) {
            $table->ulid('user_id')->primary();
            $table->string('code_hash', 64);
            $table->string('pending_email')->nullable();
            $table->string('pending_password_hash')->nullable();
            $table->timestamp('expires_at');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamps();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void {
        Schema::dropIfExists('email_verification_codes');
        Schema::dropIfExists('browser_sessions');
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['email']);
            $table->dropColumn(['email', 'password', 'email_verified_at']);
            // Keep telegram_user_id nullable: reverting it could destroy email-only accounts.
        });
    }
};
