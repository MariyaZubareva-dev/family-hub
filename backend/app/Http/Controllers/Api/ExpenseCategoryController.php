<?php

namespace App\Http\Controllers\Api;

use App\Models\ExpenseCategory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ExpenseCategoryController extends FinanceBaseController
{
    public function index(Request $request): JsonResponse
    {
        $membership = $this->adminMembership($request);

        return response()->json(['data' => ExpenseCategory::query()
            ->where('family_id', $membership->family_id)
            ->orderBy('name')
            ->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        $membership = $this->adminMembership($request);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'icon' => ['nullable', 'string', 'max:40'],
            'is_mandatory' => ['sometimes', 'boolean'],
        ]);

        $category = ExpenseCategory::create([
            ...$data,
            'family_id' => $membership->family_id,
            'created_by' => $membership->user_id,
            'status' => ExpenseCategory::ACTIVE,
        ]);
        $this->audit($membership->family_id, $membership->user_id, 'expense_category', $category->id, 'created', null, $category->toArray());

        return response()->json(['data' => $category], 201);
    }

    public function update(Request $request, ExpenseCategory $category): JsonResponse
    {
        $membership = $this->membership($request, $category->family_id);
        $this->assertAdmin($membership);
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'icon' => ['nullable', 'string', 'max:40'],
            'is_mandatory' => ['sometimes', 'boolean'],
            'status' => ['sometimes', 'in:ACTIVE,ARCHIVED'],
        ]);
        $before = $category->toArray();
        $category->update($data);
        $this->audit($membership->family_id, $membership->user_id, 'expense_category', $category->id, 'updated', $before, $category->fresh()->toArray());

        return response()->json(['data' => $category->fresh()]);
    }

    public function destroy(Request $request, ExpenseCategory $category): JsonResponse
    {
        $membership = $this->membership($request, $category->family_id);
        $this->assertAdmin($membership);
        $before = $category->toArray();

        if ($category->expenses()->exists() || $category->budgetCategories()->exists()) {
            $category->update(['status' => ExpenseCategory::ARCHIVED]);
            $action = 'archived';
        } else {
            $category->delete();
            $action = 'deleted';
        }
        $this->audit($membership->family_id, $membership->user_id, 'expense_category', $category->id, $action, $before, null);

        return response()->json([], 204);
    }
}
