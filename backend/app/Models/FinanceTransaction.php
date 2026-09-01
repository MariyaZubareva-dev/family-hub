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
    protected $casts = ['amount' => 'decimal:2', 'occurred_on' => 'date'];
    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
}
