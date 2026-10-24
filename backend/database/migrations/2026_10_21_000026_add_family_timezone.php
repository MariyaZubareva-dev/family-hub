<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void { Schema::table('families', fn (Blueprint $table) => $table->string('timezone', 64)->default('Europe/Moscow')); }
    public function down(): void { Schema::table('families', fn (Blueprint $table) => $table->dropColumn('timezone')); }
};
