<?php

namespace App\Http\Controllers\Api;

use App\Models\Expense;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ExpenseController extends FinanceBaseController
{
    public function index(Request $request): JsonResponse
    {
        $membership = $this->adminMembership($request);
        $query = Expense::query()->where('family_id', $membership->family_id)->with(['category', 'payer.user']);
        if ($request->filled('from')) $query->whereDate('expense_date', '>=', $request->date('from'));
        if ($request->filled('to')) $query->whereDate('expense_date', '<=', $request->date('to'));
        if ($request->filled('category_id')) $query->where('category_id', $request->string('category_id'));
        return response()->json(['data' => $query->orderByDesc('expense_date')->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        $membership = $this->adminMembership($request);
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'gt:0'], 'currency' => ['sometimes', 'string', 'size:3'],
            'expense_date' => ['required', 'date'], 'category_id' => ['required', 'string'], 'payer_member_id' => ['required', 'string'],
            'merchant_name' => ['nullable', 'string', 'max:255'], 'description' => ['nullable', 'string'],
            'input_method' => ['sometimes', 'in:MANUAL,TEXT,OCR'], 'status' => ['sometimes', 'in:CONFIRMED,CANCELLED'], 'financial_goal_id' => ['nullable', 'string'],
        ]);
        $this->activeCategory($membership->family_id, $data['category_id']);
        $this->activeMember($membership->family_id, $data['payer_member_id']);
        $expense = Expense::create([...$data, 'family_id' => $membership->family_id, 'created_by' => $membership->user_id]);
        $this->audit($membership->family_id, $membership->user_id, 'expense', $expense->id, 'created', null, $expense->toArray());
        return response()->json(['data' => $expense->load(['category', 'payer.user'])], 201);
    }

    public function update(Request $request, Expense $expense): JsonResponse
    {
        $membership = $this->adminMembership($request);
        abort_if($expense->family_id !== $membership->family_id, 404);
        $data = $request->validate(['amount' => ['sometimes', 'numeric', 'gt:0'], 'expense_date' => ['sometimes', 'date'], 'category_id' => ['sometimes', 'string'], 'payer_member_id' => ['sometimes', 'string'], 'merchant_name' => ['nullable', 'string', 'max:255'], 'description' => ['nullable', 'string'], 'input_method' => ['sometimes', 'in:MANUAL,TEXT,OCR'], 'status' => ['sometimes', 'in:CONFIRMED,CANCELLED'], 'financial_goal_id' => ['nullable', 'string']]);
        if (isset($data['category_id'])) $this->activeCategory($membership->family_id, $data['category_id']);
        if (isset($data['payer_member_id'])) $this->activeMember($membership->family_id, $data['payer_member_id']);
        $before = $expense->toArray();
        $expense->update($data);
        $this->audit($membership->family_id, $membership->user_id, 'expense', $expense->id, 'updated', $before, $expense->fresh()->toArray());
        return response()->json(['data' => $expense->fresh()->load(['category', 'payer.user'])]);
    }

    public function destroy(Request $request, Expense $expense): JsonResponse
    {
        $membership = $this->adminMembership($request);
        abort_if($expense->family_id !== $membership->family_id, 404);
        $before = $expense->toArray();
        $expense->delete();
        $this->audit($membership->family_id, $membership->user_id, 'expense', $expense->id, 'deleted', $before, null);
        return response()->json([], 204);
    }
}
