<?php

namespace App\Http\Controllers\Api;

use App\Models\Income;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class IncomeController extends FinanceBaseController
{
    public function index(Request $request): JsonResponse
    {
        $membership = $this->adminMembership($request);
        $items = Income::query()->where('family_id', $membership->family_id)->with('recipient.user')->orderByDesc('income_date')->get();
        return response()->json(['data' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $membership = $this->adminMembership($request);
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'gt:0'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'income_date' => ['required', 'date'],
            'source' => ['required', 'string', 'max:255'],
            'recipient_member_id' => ['required', 'string'],
            'status' => ['sometimes', 'in:PLANNED,RECEIVED,CANCELLED'],
            'comment' => ['nullable', 'string'],
        ]);
        $this->activeMember($membership->family_id, $data['recipient_member_id']);
        $income = Income::create([...$data, 'family_id' => $membership->family_id, 'created_by' => $membership->user_id]);
        $this->audit($membership->family_id, $membership->user_id, 'income', $income->id, 'created', null, $income->toArray());
        return response()->json(['data' => $income->load('recipient.user')], 201);
    }

    public function update(Request $request, Income $income): JsonResponse
    {
        $membership = $this->adminMembership($request);
        abort_if($income->family_id !== $membership->family_id, 404);
        $data = $request->validate(['amount' => ['sometimes', 'numeric', 'gt:0'], 'currency' => ['sometimes', 'string', 'size:3'], 'income_date' => ['sometimes', 'date'], 'source' => ['sometimes', 'string', 'max:255'], 'recipient_member_id' => ['sometimes', 'string'], 'status' => ['sometimes', 'in:PLANNED,RECEIVED,CANCELLED'], 'comment' => ['nullable', 'string']]);
        if (isset($data['recipient_member_id'])) $this->activeMember($membership->family_id, $data['recipient_member_id']);
        $before = $income->toArray();
        $income->update($data);
        $this->audit($membership->family_id, $membership->user_id, 'income', $income->id, 'updated', $before, $income->fresh()->toArray());
        return response()->json(['data' => $income->fresh()->load('recipient.user')]);
    }

    public function destroy(Request $request, Income $income): JsonResponse
    {
        $membership = $this->adminMembership($request);
        abort_if($income->family_id !== $membership->family_id, 404);
        $before = $income->toArray();
        $income->delete();
        $this->audit($membership->family_id, $membership->user_id, 'income', $income->id, 'deleted', $before, null);
        return response()->json([], 204);
    }
}
