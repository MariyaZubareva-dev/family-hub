<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Models\FamilyMember;

trait HasCalendarResponsibles
{
    protected function responsibleIds(string $familyId, array $data, array $fallback = []): array
    {
        $ids = $data['responsible_member_ids'] ?? (isset($data['responsible_member_id']) ? [$data['responsible_member_id']] : $fallback);
        abort_if(count($ids) === 0, 422, 'Выберите хотя бы одного ответственного.');
        $count = FamilyMember::where('family_id', $familyId)->where('status', 'ACTIVE')->whereIn('id', $ids)->count();
        abort_unless($count === count($ids), 422, 'Ответственными могут быть только активные участники вашей семьи.');
        return array_values($ids);
    }

    protected function responsibleRules(bool $required): array
    {
        return [
            'responsible_member_id' => [$required ? 'required_without:responsible_member_ids' : 'sometimes', 'string', 'exists:family_members,id'],
            'responsible_member_ids' => ['sometimes', 'array', 'min:1', 'max:100'],
            'responsible_member_ids.*' => ['required', 'string', 'distinct', 'exists:family_members,id'],
        ];
    }
}
