<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {Schema::table('credit_prepayments',fn(Blueprint $table)=>$table->string('interest_policy',24)->nullable());}
    public function down(): void {Schema::table('credit_prepayments',fn(Blueprint $table)=>$table->dropColumn('interest_policy'));}
};
