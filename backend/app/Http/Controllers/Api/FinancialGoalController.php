<?php

namespace App\Http\Controllers\Api;

use App\Models\FinancialGoal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FinancialGoalController extends FinanceBaseController
{
    public function index(Request $request): JsonResponse
    {
        $membership = $this->adminMembership($request);
        return response()->json(['data' => FinancialGoal::query()->where('family_id', $membership->family_id)->withSum('contributions', 'amount')->with('category')->orderBy('status')->orderBy('target_date')->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        $membership = $this->adminMembership($request);
        $data = $request->validate(['name' => ['required', 'string', 'max:255'], 'type' => ['required', 'string', 'max:32'], 'target_amount' => ['required', 'numeric', 'gt:0'], 'category_id' => ['nullable', 'string'], 'target_date' => ['nullable', 'date'], 'priority' => ['sometimes', 'in:LOW,MEDIUM,HIGH'], 'current_price' => ['nullable', 'numeric', 'gt:0'], 'url' => ['nullable', 'url'], 'description' => ['nullable', 'string'], 'status' => ['sometimes', 'in:PLANNED,ACTIVE,COMPLETED,CANCELLED']]);
        if (!empty($data['category_id'])) $this->activeCategory($membership->family_id, $data['category_id']);
        $goal = FinancialGoal::create([...$data, 'family_id' => $membership->family_id, 'created_by' => $membership->user_id]);
        $this->audit($membership->family_id, $membership->user_id, 'financial_goal', $goal->id, 'created', null, $goal->toArray());
        return response()->json(['data' => $goal->load('category')], 201);
    }

    public function update(Request $request, FinancialGoal $financialGoal): JsonResponse
    {
        $membership = $this->adminMembership($request);
        abort_if($financialGoal->family_id !== $membership->family_id, 404);
        $data = $request->validate(['name' => ['sometimes', 'string', 'max:255'], 'target_amount' => ['sometimes', 'numeric', 'gt:0'], 'category_id' => ['nullable', 'string'], 'target_date' => ['nullable', 'date'], 'priority' => ['sometimes', 'in:LOW,MEDIUM,HIGH'], 'current_price' => ['nullable', 'numeric', 'gt:0'], 'url' => ['nullable', 'url'], 'description' => ['nullable', 'string'], 'status' => ['sometimes', 'in:PLANNED,ACTIVE,COMPLETED,CANCELLED']]);
        if (array_key_exists('category_id', $data) && $data['category_id']) $this->activeCategory($membership->family_id, $data['category_id']);
        $before = $financialGoal->toArray();
        $financialGoal->update($data);
        $this->audit($membership->family_id, $membership->user_id, 'financial_goal', $financialGoal->id, 'updated', $before, $financialGoal->fresh()->toArray());
        return response()->json(['data' => $financialGoal->fresh()->load('category')]);
    }

    public function destroy(Request $request, FinancialGoal $financialGoal): JsonResponse
    {
        $membership = $this->adminMembership($request);
        abort_if($financialGoal->family_id !== $membership->family_id, 404);
        $before = $financialGoal->toArray();
        $financialGoal->delete();
        $this->audit($membership->family_id, $membership->user_id, 'financial_goal', $financialGoal->id, 'deleted', $before, null);
        return response()->json([], 204);
    }
}
