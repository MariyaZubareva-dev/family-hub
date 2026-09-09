<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class FinancialGoal extends Model
{
    use HasUlids, SoftDeletes;

    public const PLANNED = 'PLANNED';
    public const ACTIVE = 'ACTIVE';
    public const COMPLETED = 'COMPLETED';
    public const CANCELLED = 'CANCELLED';

    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;

    protected $casts = ['target_amount' => 'decimal:2', 'current_price' => 'decimal:2', 'target_date' => 'date'];

    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function category(): BelongsTo { return $this->belongsTo(ExpenseCategory::class, 'category_id'); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function contributions(): HasMany { return $this->hasMany(GoalContribution::class, 'goal_id'); }
    public function priceHistory(): HasMany { return $this->hasMany(GoalPriceHistory::class, 'goal_id'); }
    public function expenses(): HasMany { return $this->hasMany(Expense::class, 'financial_goal_id'); }
}
