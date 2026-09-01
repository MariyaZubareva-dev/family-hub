<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Idea extends Model
{
    use HasUlids, SoftDeletes;
    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;
    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function author(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
}
