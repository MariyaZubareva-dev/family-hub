<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FamilyMember extends Model
{
    use HasUlids;

    protected $guarded = [];
    protected $keyType = 'string';
    public $incrementing = false;
    protected $casts = ['joined_at' => 'datetime', 'section_visibility' => 'array'];

    public const SECTIONS = ['calendar', 'shopping', 'finance'];

    public function visibleSections(): array
    {
        $defaults = array_fill_keys(self::SECTIONS, true);
        return $this->role === 'ADMIN' ? $defaults : array_replace($defaults, $this->section_visibility ?? []);
    }

    public function canViewSection(string $section): bool
    {
        return $this->status === 'ACTIVE' && ($this->visibleSections()[$section] ?? false);
    }

    public static function notificationSection(string $type): ?string
    {
        return match ($type) {
            'EVENT_REMINDER', 'EVENT_CHANGED', 'EVENT_CANCELLED', 'REMINDER' => 'calendar',
            'PURCHASE_DUE' => 'shopping',
            'AI_READY_FOR_REVIEW', 'BUDGET_WARNING' => 'finance',
            default => null,
        };
    }

    public function family(): BelongsTo { return $this->belongsTo(Family::class); }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function inviter(): BelongsTo { return $this->belongsTo(User::class, 'invited_by'); }
}
