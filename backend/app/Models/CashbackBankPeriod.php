<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class CashbackBankPeriod extends Model
{
    use HasUlids, SoftDeletes;
    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;
    protected $casts = ['entries'=>'array', 'revision'=>'integer'];
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    public static function bankKey(string $name): string
    {
        return \App\Services\Finance\CashbackBankCatalog::key($name);
    }
}
