<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Expense extends Model
{
    use HasUlids, SoftDeletes;

    public const CONFIRMED = 'CONFIRMED';
    public const CANCELLED = 'CANCELLED';

    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;

    protected $casts = ['amount' => 'decimal:2', 'expense_date' => 'date'];

    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function category(): BelongsTo { return $this->belongsTo(ExpenseCategory::class, 'category_id'); }
    public function payer(): BelongsTo { return $this->belongsTo(FamilyMember::class, 'payer_member_id'); }
    public function goal(): BelongsTo { return $this->belongsTo(FinancialGoal::class, 'financial_goal_id'); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
}
