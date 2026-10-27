<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\{DB, Schema};

return new class extends Migration {
    public function up(): void
    {
        Schema::table('receipts', function (Blueprint $table) {
            $table->json('qr_data')->nullable();
            $table->string('qr_fingerprint',64)->nullable();
            $table->string('qr_state',32)->nullable();
            $table->unsignedSmallInteger('qr_attempts')->default(0);
            $table->timestamp('qr_next_attempt_at')->nullable()->index();
        });
        DB::statement('CREATE UNIQUE INDEX receipts_family_qr_unique ON receipts (family_id, qr_fingerprint) WHERE deleted_at IS NULL');
    }
    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS receipts_family_qr_unique');
        Schema::table('receipts', fn(Blueprint $table)=>$table->dropColumn(['qr_data','qr_fingerprint','qr_state','qr_attempts','qr_next_attempt_at']));
    }
};
