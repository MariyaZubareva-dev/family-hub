<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Reminder extends Model
{
    use HasUlids;
    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;
    protected $casts = ['scheduled_at' => 'datetime'];
    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function responsibleMember(): BelongsTo { return $this->belongsTo(FamilyMember::class, 'responsible_member_id'); }
}
