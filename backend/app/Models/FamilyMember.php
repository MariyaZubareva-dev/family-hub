<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FamilyMember extends Model
{
    use HasUlids;

    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;
    protected $casts = ['joined_at' => 'datetime'];

    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function inviter(): BelongsTo { return $this->belongsTo(User::class, 'invited_by'); }
}
