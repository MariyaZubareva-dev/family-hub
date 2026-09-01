<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class FamilyList extends Model
{
    use HasUlids, SoftDeletes;

    protected $table = 'lists';
    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;

    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function items(): HasMany { return $this->hasMany(ListItem::class, 'list_id')->orderBy('position'); }
}
