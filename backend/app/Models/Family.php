<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Family extends Model
{
    use HasUlids, SoftDeletes;

    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;

    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function members(): HasMany { return $this->hasMany(FamilyMember::class); }
    public function lists(): HasMany { return $this->hasMany(FamilyList::class); }
    public function events(): HasMany { return $this->hasMany(Event::class); }
    public function reminders(): HasMany { return $this->hasMany(Reminder::class); }
    public function notes(): HasMany { return $this->hasMany(Note::class); }
    public function ideas(): HasMany { return $this->hasMany(Idea::class); }
    public function transactions(): HasMany { return $this->hasMany(FinanceTransaction::class); }
}
