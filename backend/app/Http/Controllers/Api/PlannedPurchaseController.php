<?php

namespace App\Http\Controllers\Api;

use App\Models\PlannedPurchase;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class PlannedPurchaseController extends BaseApiController
{
    public function categories(Request $request): JsonResponse
    {
        $member = $this->membership($request);
        return response()->json(['data' => DB::table('purchase_categories')
            ->where('family_id', $member->family_id)->orderBy('name')->get(['id', 'name'])]);
    }

    public function createCategory(Request $request): JsonResponse
    {
        $member = $this->membership($request);
        $request->merge(['name' => is_string($request->input('name')) ? trim($request->input('name')) : $request->input('name')]);
        $data = $request->validate(['name' => ['required', 'string', 'max:120']], [
            'name.required' => 'Введите название категории.',
            'name.max' => 'Название категории должно быть не длиннее 120 символов.',
        ]);
        $key = mb_strtolower($data['name']);
        $created = DB::table('purchase_categories')->insertOrIgnore([
            'id' => (string) Str::ulid(), 'family_id' => $member->family_id,
            'name' => $data['name'], 'name_key' => $key,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $category = DB::table('purchase_categories')->where('family_id', $member->family_id)
            ->where('name_key', $key)->first(['id', 'name']);
        return response()->json(['data' => $category], $created ? 201 : 200);
    }

    public function index(Request $request): JsonResponse
    {
        $member = $this->membership($request);
        $query = PlannedPurchase::query()
            ->where('family_id', $member->family_id)
            ->where('status', 'ACTIVE')
            ->with('creator')
            ->orderByRaw("CASE WHEN type = 'RECURRING' THEN 0 ELSE 1 END")
            ->orderByRaw('COALESCE(due_date, last_purchased_at) ASC');

        if ($request->filled('type')) {
            $query->where('type', $request->string('type')->toString());
        }

        $items = $query->get()->map(function (PlannedPurchase $item) {
            $item->next_due_at = $item->due_date?->toDateString();
            $item->days_until_due = $item->due_date
                ? Carbon::today()->diffInDays($item->due_date, false)
                : null;
            return $item;
        });

        return response()->json(['data' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $member = $this->membership($request);
        $data = $this->validated($request);

        if ($data['type'] === 'RECURRING' && (empty($data['due_date']) || empty($data['cadence_months']))) {
            return response()->json(['message' => 'Для регулярной покупки укажите дату и периодичность.'], 422);
        }

        $item = PlannedPurchase::create([
            ...$data,
            'family_id' => $member->family_id,
            'created_by' => $member->user_id,
            'status' => 'ACTIVE',
        ]);

        return response()->json(['data' => $item->load('creator')], 201);
    }

    public function update(Request $request, PlannedPurchase $plannedPurchase): JsonResponse
    {
        $member = $this->membership($request, $plannedPurchase->family_id);
        abort_unless($member->role === 'ADMIN' || $plannedPurchase->created_by === $member->user_id, 403);
        $data = $this->validated($request, false);

        if (($data['type'] ?? $plannedPurchase->type) === 'RECURRING'
            && (empty($data['due_date'] ?? $plannedPurchase->due_date)
                || empty($data['cadence_months'] ?? $plannedPurchase->cadence_months))) {
            return response()->json(['message' => 'Для регулярной покупки укажите дату и периодичность.'], 422);
        }

        $plannedPurchase->update($data);
        return response()->json(['data' => $plannedPurchase->fresh()->load('creator')]);
    }

    public function destroy(Request $request, PlannedPurchase $plannedPurchase): JsonResponse
    {
        $member = $this->membership($request, $plannedPurchase->family_id);
        abort_unless($member->role === 'ADMIN' || $plannedPurchase->created_by === $member->user_id, 403);
        $plannedPurchase->delete();
        return response()->json([], 204);
    }

    public function markPurchased(Request $request, PlannedPurchase $plannedPurchase): JsonResponse
    {
        $member = $this->membership($request, $plannedPurchase->family_id);
        abort_unless($plannedPurchase->type === 'RECURRING', 422, 'Отметить покупку можно только в регулярном списке.');
        abort_if(!$plannedPurchase->cadence_months, 422, 'Укажите периодичность перед отметкой о покупке.');

        $data = $request->validate(['purchased_on' => ['nullable', 'date', 'before_or_equal:today']]);
        $purchasedOn = Carbon::parse($data['purchased_on'] ?? today());
        $plannedPurchase->update([
            'last_purchased_at' => $purchasedOn->toDateString(),
            'due_date' => $purchasedOn->copy()->addMonthsNoOverflow((int) $plannedPurchase->cadence_months)->toDateString(),
        ]);

        return response()->json(['data' => $plannedPurchase->fresh()->load('creator')]);
    }

    private function validated(Request $request, bool $required = true): array
    {
        $req = $required ? 'required' : 'sometimes';
        return $request->validate([
            'type' => [$req, 'in:LARGE,RECURRING'],
            'name' => [$req, 'string', 'max:255'],
            'category' => ['nullable', 'string', 'max:120'],
            'estimated_amount' => ['nullable', 'numeric', 'min:0'],
            'due_date' => ['nullable', 'date'],
            'cadence_months' => ['nullable', 'integer', 'between:1,120'],
            'notify_days_before' => ['sometimes', 'integer', 'between:0,90'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);
    }
}
