<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Event extends Model
{
    use HasUlids, SoftDeletes;
    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;
    protected $casts = ['start_at' => 'datetime', 'end_at' => 'datetime'];
    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function responsibleMember(): BelongsTo { return $this->belongsTo(FamilyMember::class, 'responsible_member_id'); }
    public function participants(): BelongsToMany { return $this->belongsToMany(FamilyMember::class, 'event_participants'); }
}
