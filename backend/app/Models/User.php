<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;

class User extends Authenticatable
{
    use HasUlids;

    protected $guarded = [];
    protected $hidden = ['password', 'remember_token', 'email', 'email_verified_at'];
    protected $keyType = 'string';
    public $incrementing = false;

    public function familyMembers(): HasMany
    {
        return $this->hasMany(FamilyMember::class);
    }
}
