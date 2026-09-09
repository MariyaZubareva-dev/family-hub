<?php

namespace App\Services\Finance;

use App\Models\Budget;
use App\Models\Expense;
use App\Models\FinancialGoal;
use App\Models\GoalContribution;
use App\Models\Income;
use App\Models\FamilyMember;
use Carbon\CarbonImmutable;

class FinanceOverviewService
{
    public function build(FamilyMember $membership, int $year, int $month): array
    {
        $start = CarbonImmutable::create($year, $month, 1, 0, 0, 0, $membership->user->timezone ?: 'Europe/Moscow')->startOfMonth();
        $end = $start->endOfMonth();
        $familyId = $membership->family_id;

        $budget = Budget::query()
            ->where('family_id', $familyId)
            ->where('year', $year)
            ->where('month', $month)
            ->with('categories.category')
            ->first();

        $expenses = Expense::query()
            ->where('family_id', $familyId)
            ->where('status', Expense::CONFIRMED)
            ->whereBetween('expense_date', [$start->toDateString(), $end->toDateString()])
            ->with('category')
            ->get();

        $spentByCategory = $expenses->groupBy('category_id')->map(fn ($items) => round((float) $items->sum('amount'), 2));
        $spent = round((float) $expenses->sum('amount'), 2);
        $receivedIncome = round((float) Income::query()
            ->where('family_id', $familyId)
            ->where('status', Income::RECEIVED)
            ->whereBetween('income_date', [$start->toDateString(), $end->toDateString()])
            ->sum('amount'), 2);
        $plannedIncome = round((float) Income::query()
            ->where('family_id', $familyId)
            ->where('status', Income::PLANNED)
            ->whereBetween('income_date', [$start->toDateString(), $end->toDateString()])
            ->sum('amount'), 2);
        $contributions = round((float) GoalContribution::query()
            ->whereBetween('contribution_date', [$start->toDateString(), $end->toDateString()])
            ->whereHas('goal', fn ($query) => $query->where('family_id', $familyId))
            ->sum('amount'), 2);

        $totalLimit = $budget ? (float) $budget->total_limit : 0.0;
        $categoryBudgets = $budget?->categories->map(function ($budgetCategory) use ($spentByCategory) {
            $limit = round((float) $budgetCategory->limit_amount, 2);
            $spentAmount = (float) ($spentByCategory[$budgetCategory->category_id] ?? 0);

            return [
                'category_id' => $budgetCategory->category_id,
                'name' => $budgetCategory->category->name,
                'icon' => $budgetCategory->category->icon,
                'limit_amount' => $limit,
                'spent_amount' => $spentAmount,
                'remaining_amount' => round($limit - $spentAmount, 2),
                'progress_percent' => $limit > 0 ? min(100, round($spentAmount / $limit * 100, 1)) : 0,
            ];
        })->values()->all() ?? [];

        $expenseChart = $expenses->groupBy('category_id')->map(function ($items) use ($spent) {
            $amount = round((float) $items->sum('amount'), 2);
            $category = $items->first()->category;

            return [
                'category_id' => $category?->id,
                'name' => $category?->name ?? 'Без категории',
                'amount' => $amount,
                'percent' => $spent > 0 ? round($amount / $spent * 100, 1) : 0,
            ];
        })->values()->sortByDesc('amount')->values()->all();

        return [
            'period' => ['year' => $year, 'month' => $month],
            'budget' => [
                'id' => $budget?->id,
                'status' => $budget?->status,
                'total_limit' => $totalLimit,
                'spent_amount' => $spent,
                'available_amount' => round($totalLimit - $spent, 2),
                'progress_percent' => $totalLimit > 0 ? min(100, round($spent / $totalLimit * 100, 1)) : 0,
                'categories' => $categoryBudgets,
            ],
            'fact' => [
                'received_income' => $receivedIncome,
                'confirmed_expenses' => $spent,
                'confirmed_goal_contributions' => $contributions,
                'available_cash' => round($receivedIncome - $spent - $contributions, 2),
            ],
            'forecast' => [
                'planned_income' => $plannedIncome,
                'forecasted_balance' => round($receivedIncome + $plannedIncome - $spent - $contributions, 2),
            ],
            'expense_chart' => $expenseChart,
        ];
    }
}
