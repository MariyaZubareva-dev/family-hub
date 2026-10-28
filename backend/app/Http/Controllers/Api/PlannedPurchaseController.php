<?php

namespace App\Http\Controllers\Api;

use App\Models\PlannedPurchase;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use App\Models\ExpenseCategory;
use App\Services\Finance\CategoryCatalog;

class PlannedPurchaseController extends BaseApiController
{
    public function categories(Request $request): JsonResponse
    {
        $member = $this->membership($request);
        CategoryCatalog::ensureDefaults($member->family_id, $member->user_id);
        return response()->json(['data' => ExpenseCategory::query()
            ->where('family_id', $member->family_id)->where('transaction_type', 'EXPENSE')
            ->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name'])]);
    }

    public function createCategory(Request $request): JsonResponse
    {
        // Reuse Finance validation and admin permissions for the shared catalog.
        $request->merge(['transaction_type' => 'EXPENSE']);
        return app(FinanceCoreController::class)->createCategory($request);
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
        $data = $this->pricing($this->validated($request));

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
        $data = $this->pricing($this->validated($request, false), $plannedPurchase);

        if (($data['type'] ?? $plannedPurchase->type) === 'RECURRING'
            && (empty($data['due_date'] ?? $plannedPurchase->due_date)
                || empty($data['cadence_months'] ?? $plannedPurchase->cadence_months))) {
            return response()->json(['message' => 'Для регулярной покупки укажите дату и периодичность.'], 422);
        }

        $plannedPurchase->update([...$data,'purchase_revision'=>\Illuminate\Support\Facades\DB::raw('purchase_revision + 1')]);
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

        $service=app(\App\Services\StoreListService::class);
        $today=$service->today($member->family_id);
        $data = $request->validate(['purchased_on' => ['nullable', 'date', 'before_or_equal:'.$today]]);
        return response()->json(['data'=>$service->purchased($plannedPurchase,$data['purchased_on'] ?? $today,$member->user_id)]);
    }

    private function pricing(array $data, ?PlannedPurchase $existing = null): array
    {
        if (($data['type'] ?? $existing?->type) !== 'RECURRING') {
            unset($data['unit_price'], $data['quantity']);
            return $data;
        }
        $quantity = (int) ($data['quantity'] ?? $existing?->quantity ?? 1);
        $price = array_key_exists('unit_price', $data) ? $data['unit_price'] : $existing?->unit_price;
        // Accept older clients that only submit a total, without multiplying it again.
        if (!array_key_exists('unit_price', $data) && array_key_exists('estimated_amount', $data)) {
            $quantity = 1;
            $price = $data['estimated_amount'];
        }
        $totalCents = $price === null ? null : (int) round((float) $price * 100) * $quantity;
        if ($totalCents !== null && $totalCents > 99999999999999) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'unit_price' => 'Итоговая сумма не должна превышать 999 999 999 999,99 ₽.',
            ]);
        }
        return [...$data, 'quantity' => $quantity, 'unit_price' => $price,
            'estimated_amount' => $totalCents === null ? null : number_format($totalCents / 100, 2, '.', '')];
    }

    private function validated(Request $request, bool $required = true): array
    {
        $req = $required ? 'required' : 'sometimes';
        return $request->validate([
            'type' => [$req, 'in:LARGE,RECURRING'],
            'name' => [$req, 'string', 'max:255'],
            'category' => ['nullable', 'string', 'max:120'],
            'estimated_amount' => ['nullable', 'numeric', 'min:0', 'max:999999999999.99'],
            'unit_price' => ['nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:999999999999.99'],
            'quantity' => ['sometimes', 'required', 'integer', 'between:1,9999'],
            'due_date' => ['nullable', 'date'],
            'cadence_months' => ['nullable', 'integer', 'between:1,120'],
            'notify_days_before' => ['sometimes', 'integer', 'between:0,90'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);
    }
}
