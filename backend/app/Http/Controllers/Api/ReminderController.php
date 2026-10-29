<?php

namespace App\Http\Controllers\Api;

use App\Models\{Reminder, FamilyMember};
use Illuminate\Http\{JsonResponse, Request};

class ReminderController extends BaseApiController
{
    use Concerns\HasCalendarResponsibles;

    private function canEdit(Reminder $reminder, FamilyMember $member): bool
    {
        return $member->role === 'ADMIN' || $reminder->created_by === $member->user_id;
    }

    private function canComplete(Reminder $reminder, FamilyMember $member): bool
    {
        return $this->canEdit($reminder, $member)
            || in_array($member->id, $reminder->responsible_member_ids ?: [$reminder->responsible_member_id], true);
    }

    private function data(Reminder $reminder, FamilyMember $member): array
    {
        return [...$reminder->toArray(), 'can_edit' => $this->canEdit($reminder, $member),
            'can_complete' => $this->canComplete($reminder, $member)];
    }

    public function index(Request $request): JsonResponse
    {
        $member = $this->membership($request);
        $items = Reminder::where('family_id', $member->family_id)->with(['creator', 'responsibleMember.user'])
            ->orderBy('scheduled_at')->get()->map(fn ($item) => $this->data($item, $member));
        return response()->json(['data' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $member = $this->membership($request);
        $data = $request->validate($this->rules(true));
        $ids = $this->responsibleIds($member->family_id, $data);
        $data['responsible_member_ids'] = $ids;
        $data['responsible_member_id'] = $ids[0];
        $data['timezone'] = $data['timezone'] ?? $member->family->timezone ?? 'Europe/Moscow';
        $item = Reminder::create([...$data, 'family_id' => $member->family_id, 'created_by' => $member->user_id]);
        return response()->json(['data' => $this->data($item->fresh()->load(['creator', 'responsibleMember.user']), $member)], 201);
    }

    public function update(Request $request, Reminder $reminder): JsonResponse
    {
        $member = $this->membership($request, $reminder->family_id);
        return \Illuminate\Support\Facades\DB::transaction(function () use ($request, $reminder, $member) {
            $reminder = Reminder::whereKey($reminder->id)->lockForUpdate()->firstOrFail();
            $statusOnly = array_keys($request->all()) === ['status']
                && in_array($request->input('status'), ['SCHEDULED', 'COMPLETED'], true)
                && in_array($reminder->status, ['SCHEDULED', 'COMPLETED'], true);
            abort_unless($this->canEdit($reminder, $member) || ($statusOnly && $this->canComplete($reminder, $member)), 403);
            $data = $request->validate([...$this->rules(false), 'status' => ['sometimes', 'in:SCHEDULED,COMPLETED,CANCELLED']]);
            if (isset($data['responsible_member_id']) || array_key_exists('responsible_member_ids', $data)) {
                $ids = $this->responsibleIds($member->family_id, $data);
                $data['responsible_member_ids'] = $ids;
                $data['responsible_member_id'] = $ids[0];
            }
            $reminder->update($data);
            return response()->json(['data' => $this->data($reminder->fresh()->load(['creator', 'responsibleMember.user']), $member)]);
        });
    }

    public function destroy(Request $request, Reminder $reminder): JsonResponse
    {
        $member = $this->membership($request, $reminder->family_id);
        abort_unless($this->canEdit($reminder, $member), 403);
        $reminder->delete();
        return response()->json([], 204);
    }

    private function rules(bool $creating): array
    {
        return [
            'title' => [$creating ? 'required' : 'sometimes', 'required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:2000'],
            'scheduled_at' => [$creating ? 'required' : 'sometimes', 'required', 'date'],
            'timezone' => ['nullable', 'timezone'],
            ...$this->responsibleRules($creating),
            'recurrence_rule' => ['nullable', 'string', 'max:255'],
        ];
    }
}
