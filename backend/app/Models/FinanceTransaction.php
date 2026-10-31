<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FinanceTransaction extends Model
{
    use HasUlids;
    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;
    // This is a calendar date, not a timestamp. Serialize it without a timezone
    // so clients cannot shift it to the previous day when parsing UTC midnight.
    protected $casts = ['amount' => 'decimal:2', 'occurred_on' => 'date:Y-m-d'];
    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
}
