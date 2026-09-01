<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class ListItem extends Model
{
    use HasUlids, SoftDeletes;
    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;
    protected $casts = ['is_completed' => 'boolean', 'completed_at' => 'datetime'];
    public function list(): BelongsTo { return $this->belongsTo(FamilyList::class, 'list_id'); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function completer(): BelongsTo { return $this->belongsTo(User::class, 'completed_by'); }
}
