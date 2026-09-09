<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Income extends Model
{
    use HasUlids, SoftDeletes;

    public const PLANNED = 'PLANNED';
    public const RECEIVED = 'RECEIVED';
    public const CANCELLED = 'CANCELLED';

    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;

    protected $casts = ['amount' => 'decimal:2', 'income_date' => 'date'];

    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function recipient(): BelongsTo { return $this->belongsTo(FamilyMember::class, 'recipient_member_id'); }
    public function budget(): BelongsTo { return $this->belongsTo(Budget::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
}
