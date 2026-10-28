<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class PlannedPurchase extends Model
{
    use HasUlids, SoftDeletes;

    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;

    protected $casts = [
        'estimated_amount' => 'decimal:2',
        'unit_price' => 'decimal:2',
        'quantity' => 'integer',
        'due_date' => 'date:Y-m-d',
        'last_purchased_at' => 'date:Y-m-d',
        'cadence_months' => 'integer',
        'notify_days_before' => 'integer',
    ];

    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
}
