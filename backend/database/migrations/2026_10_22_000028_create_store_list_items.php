<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('planned_purchases',fn(Blueprint $t)=>$t->unsignedBigInteger('purchase_revision')->default(0));
        Schema::create('store_list_items',function(Blueprint $t){
            $t->ulid('id')->primary();
            $t->foreignUlid('family_id')->constrained('families')->cascadeOnDelete();
            $t->foreignUlid('created_by')->constrained('users');
            $t->string('name',255); $t->string('quantity',80)->nullable(); $t->string('notes',500)->nullable();
            $t->boolean('is_completed')->default(false);
            $t->foreignUlid('completed_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamp('completed_at')->nullable();
            $t->foreignUlid('recurring_purchase_id')->nullable()->constrained('planned_purchases')->nullOnDelete();
            $t->date('recurring_due_date')->nullable();
            $t->date('previous_purchased_on')->nullable(); $t->date('purchased_on')->nullable();
            $t->date('rescheduled_due_date')->nullable(); $t->unsignedBigInteger('schedule_revision')->nullable();
            $t->timestamps(); $t->softDeletes();
            // Include deleted rows: removing a generated item dismisses this cycle permanently.
            $t->unique(['recurring_purchase_id','recurring_due_date'],'store_recurring_cycle_unique');
            $t->index(['family_id','is_completed']);
        });
    }
    public function down(): void
    {
        Schema::dropIfExists('store_list_items');
        Schema::table('planned_purchases',fn(Blueprint $t)=>$t->dropColumn('purchase_revision'));
    }
};
