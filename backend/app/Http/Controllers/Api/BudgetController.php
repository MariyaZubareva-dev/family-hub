<?php

namespace App\Http\Controllers\Api;

use App\Models\Budget;
use App\Models\BudgetCategory;
use App\Models\ExpenseCategory;
use App\Services\Finance\FinanceOverviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BudgetController extends FinanceBaseController
{
    public function show(Request $request, int $year, int $month, FinanceOverviewService $overview): JsonResponse
    {
        $membership = $this->adminMembership($request);
        $this->assertPeriod($year, $month);

        return response()->json(['data' => $overview->build($membership, $year, $month)]);
    }

    public function upsert(Request $request, int $year, int $month, FinanceOverviewService $overview): JsonResponse
    {
        $membership = $this->adminMembership($request);
        $this->assertPeriod($year, $month);
        $data = $request->validate([
            'total_limit' => ['required', 'numeric', 'min:0'],
            'categories' => ['present', 'array'],
            'categories.*.category_id' => ['required', 'string', 'distinct'],
            'categories.*.limit_amount' => ['required', 'numeric', 'min:0'],
        ]);

        DB::transaction(function () use ($membership, $year, $month, $data) {
            foreach ($data['categories'] as $item) {
                $this->activeCategory($membership->family_id, $item['category_id']);
            }

            $budget = Budget::query()->updateOrCreate(
                ['family_id' => $membership->family_id, 'year' => $year, 'month' => $month],
                ['total_limit' => $data['total_limit'], 'status' => 'ACTIVE', 'created_by' => $membership->user_id],
            );
            $categoryIds = collect($data['categories'])->pluck('category_id')->all();
            BudgetCategory::query()->where('budget_id', $budget->id)->when($categoryIds, fn ($query) => $query->whereNotIn('category_id', $categoryIds))->delete();

            foreach ($data['categories'] as $item) {
                BudgetCategory::query()->updateOrCreate(
                    ['budget_id' => $budget->id, 'category_id' => $item['category_id']],
                    ['limit_amount' => $item['limit_amount']],
                );
            }
            $this->audit($membership->family_id, $membership->user_id, 'budget', $budget->id, 'updated', null, ['year' => $year, 'month' => $month, 'total_limit' => $data['total_limit']]);
        });

        return response()->json(['data' => $overview->build($membership, $year, $month)]);
    }

    private function assertPeriod(int $year, int $month): void
    {
        abort_unless($year >= 2000 && $year <= 2200 && $month >= 1 && $month <= 12, 422, 'Invalid budget period.');
    }
}
