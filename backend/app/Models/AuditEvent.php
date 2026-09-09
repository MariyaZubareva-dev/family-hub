<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AuditEvent extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;

    protected $casts = ['before_json' => 'array', 'after_json' => 'array', 'created_at' => 'datetime'];

    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function actor(): BelongsTo { return $this->belongsTo(User::class, 'actor_user_id'); }
}
