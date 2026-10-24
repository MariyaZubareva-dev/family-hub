<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['events', 'reminders'] as $table) {
            Schema::table($table, fn (Blueprint $blueprint) => $blueprint->json('responsible_member_ids')->nullable());
            foreach (DB::table($table)->whereNotNull('responsible_member_id')->select('id', 'responsible_member_id')->cursor() as $row) {
                DB::table($table)->where('id', $row->id)->update(['responsible_member_ids' => json_encode([$row->responsible_member_id])]);
            }
        }
    }

    public function down(): void
    {
        foreach (['events', 'reminders'] as $table) {
            Schema::table($table, fn (Blueprint $blueprint) => $blueprint->dropColumn('responsible_member_ids'));
        }
    }
};
