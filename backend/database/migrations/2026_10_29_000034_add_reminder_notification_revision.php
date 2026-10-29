<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('reminders', fn (Blueprint $table) => $table->unsignedBigInteger('notification_revision')->default(0));
    }

    public function down(): void
    {
        Schema::table('reminders', fn (Blueprint $table) => $table->dropColumn('notification_revision'));
    }
};
