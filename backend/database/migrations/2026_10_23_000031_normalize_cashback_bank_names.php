<?php
use App\Services\Finance\NormalizeCashbackBanks;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if(!Schema::hasTable('cashback_bank_normalization_backups'))Schema::create('cashback_bank_normalization_backups',function(Blueprint $table){$table->ulid('original_id')->primary();$table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();$table->foreignUlid('created_by')->constrained('users')->cascadeOnDelete();$table->jsonb('payload');$table->timestamp('normalized_at');});
        app(NormalizeCashbackBanks::class)->run(true);
    }
    public function down(): void { /* Keep original snapshots; do not overwrite edits made after normalization. */ }
};
