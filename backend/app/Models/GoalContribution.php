<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GoalContribution extends Model
{
    use HasUlids;

    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;

    protected $casts = ['amount' => 'decimal:2', 'contribution_date' => 'date'];

    public function goal(): BelongsTo { return $this->belongsTo(FinancialGoal::class, 'goal_id'); }
    public function budget(): BelongsTo { return $this->belongsTo(Budget::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
}
