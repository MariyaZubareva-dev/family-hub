<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::table('credits',fn(Blueprint $table)=>$table->json('bank_schedule')->nullable());
        Schema::create('credit_payments',function(Blueprint $table){
            $table->ulid('id')->primary();$table->foreignUlid('credit_id')->constrained('credits')->cascadeOnDelete();
            $table->foreignUlid('created_by')->constrained('users');$table->date('paid_on');$table->date('scheduled_on');
            $table->decimal('amount',14,2);$table->string('comment',255)->nullable();$table->timestamps();
            $table->index(['credit_id','scheduled_on']);
        });
    }
    public function down(): void {Schema::dropIfExists('credit_payments');Schema::table('credits',fn(Blueprint $table)=>$table->dropColumn('bank_schedule'));}
};
