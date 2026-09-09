<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditEvent;
use App\Models\ExpenseCategory;
use App\Models\FamilyMember;
use Illuminate\Http\Request;

abstract class FinanceBaseController extends BaseApiController
{
    protected function adminMembership(Request $request): FamilyMember
    {
        $membership = $this->membership($request);
        $this->assertAdmin($membership);

        return $membership;
    }

    protected function activeMember(string $familyId, string $memberId): FamilyMember
    {
        return FamilyMember::query()
            ->whereKey($memberId)
            ->where('family_id', $familyId)
            ->where('status', 'ACTIVE')
            ->firstOrFail();
    }

    protected function activeCategory(string $familyId, string $categoryId): ExpenseCategory
    {
        return ExpenseCategory::query()
            ->whereKey($categoryId)
            ->where('family_id', $familyId)
            ->where('status', ExpenseCategory::ACTIVE)
            ->firstOrFail();
    }

    protected function audit(string $familyId, ?string $actorId, string $entityType, string $entityId, string $action, ?array $before, ?array $after): void
    {
        AuditEvent::create([
            'family_id' => $familyId,
            'actor_user_id' => $actorId,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'action' => $action,
            'before_json' => $before,
            'after_json' => $after,
        ]);
    }
}
