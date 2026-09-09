<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GoalPriceHistory extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;

    protected $casts = ['price' => 'decimal:2', 'recorded_at' => 'datetime'];

    public function goal(): BelongsTo { return $this->belongsTo(FinancialGoal::class, 'goal_id'); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
}
