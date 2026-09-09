<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class ExpenseCategory extends Model
{
    use HasUlids, SoftDeletes;

    public const ACTIVE = 'ACTIVE';
    public const ARCHIVED = 'ARCHIVED';

    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;

    protected $casts = ['is_mandatory' => 'boolean'];

    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function expenses(): HasMany { return $this->hasMany(Expense::class, 'category_id'); }
    public function budgetCategories(): HasMany { return $this->hasMany(BudgetCategory::class, 'category_id'); }
}
