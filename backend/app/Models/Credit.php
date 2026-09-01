<?php

namespace App\Models;

use DateTimeInterface;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Credit extends Model
{
    use HasUlids;

    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;

    protected $casts = [
        'principal' => 'decimal:2',
        'annual_rate' => 'decimal:4',
        'standard_payment' => 'decimal:2',
        'term_months' => 'integer',
        'payment_schedule' => 'array',
        'start_date' => 'date',
        'recalculation_mode' => 'string',
        'status' => 'string',
    ];

    protected function serializeDate(DateTimeInterface $date): string
    {
        return $date->format('Y-m-d');
    }

    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function prepayments(): HasMany { return $this->hasMany(CreditPrepayment::class); }
}
