<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void { Schema::create('finance_transactions', function(Blueprint $table){ $table->ulid('id')->primary(); $table->foreignUlid('family_id')->constrained('families')->cascadeOnDelete(); $table->foreignUlid('created_by')->constrained('users'); $table->string('type',16); $table->decimal('amount',12,2); $table->string('category',80); $table->string('budget_type',32)->default('FLEXIBLE'); $table->string('description',255)->nullable(); $table->date('occurred_on'); $table->timestamps(); $table->index(['family_id','occurred_on']); }); }
 public function down(): void { Schema::dropIfExists('finance_transactions'); }
};
