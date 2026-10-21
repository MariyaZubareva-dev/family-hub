<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_categories', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('name_key', 120);
            $table->timestamps();
            $table->unique(['family_id', 'name_key']);
        });

        foreach (DB::table('planned_purchases')->whereNotNull('category')->select('family_id', 'category')->distinct()->cursor() as $purchase) {
            $name = trim($purchase->category);
            if ($name === '') continue;
            DB::table('purchase_categories')->insertOrIgnore([
                'id' => (string) Str::ulid(), 'family_id' => $purchase->family_id,
                'name' => $name, 'name_key' => mb_strtolower($name),
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_categories');
    }
};
