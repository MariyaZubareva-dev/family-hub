<?php

namespace App\Http\Controllers\Api;

use App\Models\Credit;
use App\Models\CreditPrepayment;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CreditController extends BaseApiController
{
    public function index(Request $request): JsonResponse
    {
        $membership = $this->membership($request);
        $this->assertAdmin($membership);

        $credits = Credit::where('family_id', $membership->family_id)
            ->where('status', 'ACTIVE')
            ->with(['prepayments' => fn ($query) => $query->orderBy('paid_on')])
            ->orderBy('created_at')
            ->get();

        return response()->json(['data' => $credits]);
    }

    public function store(Request $request): JsonResponse
    {
        $membership = $this->membership($request);
        $this->assertAdmin($membership);

        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:120'],
            'principal' => ['required', 'numeric', 'gt:0'],
            'annual_rate' => ['required', 'numeric', 'min:0', 'max:100'],
            'standard_payment' => ['required', 'numeric', 'gt:0'],
            'term_months' => ['required', 'integer', 'min:1', 'max:600'],
            'payment_schedule' => ['nullable', 'array'],
            'payment_schedule.*.from_month' => ['required_with:payment_schedule', 'integer', 'min:1', 'max:600'],
            'payment_schedule.*.to_month' => ['required_with:payment_schedule', 'integer', 'min:1', 'max:600'],
            'payment_schedule.*.amount' => ['required_with:payment_schedule', 'numeric', 'gt:0'],
            'start_date' => ['required', 'date'],
            'first_payment_date' => ['required', 'date', 'after_or_equal:start_date'],
            'recalculation_mode' => ['required', 'in:TERM,PAYMENT'],
        ]);

        if (!empty($data['payment_schedule'])) {
            $expectedMonth = 1;
            foreach ($data['payment_schedule'] as $index => $segment) {
                $from = (int) $segment['from_month'];
                $to = (int) $segment['to_month'];
                if ($from !== $expectedMonth) {
                    return response()->json(['message' => "Payment schedule row #" . ($index + 1) . ": expected from_month {$expectedMonth}."], 422);
                }
                if ($from > $to) {
                    return response()->json(['message' => "Payment schedule row #" . ($index + 1) . ": from_month must be <= to_month."], 422);
                }
                if ($to > (int) $data['term_months']) {
                    return response()->json(['message' => "Payment schedule row #" . ($index + 1) . ": to_month cannot exceed term_months."], 422);
                }
                $expectedMonth = $to + 1;
            }
            if ($expectedMonth !== ((int) $data['term_months'] + 1)) {
                return response()->json(['message' => 'Payment schedule must cover all months of the loan term.'], 422);
            }
        }

        $credit = Credit::create([
            ...$data,
            'name' => $data['name'] ?? 'Кредит',
            'family_id' => $membership->family_id,
            'created_by' => $membership->user_id,
            'status' => 'ACTIVE',
        ]);

        return response()->json(['data' => $credit->load(['prepayments' => fn ($query) => $query->orderBy('paid_on')])], 201);
    }

    public function update(Request $request, Credit $credit): JsonResponse
    {
        $membership = $this->membership($request, $credit->family_id);
        $this->assertAdmin($membership);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'principal' => ['sometimes', 'numeric', 'gt:0'],
            'annual_rate' => ['sometimes', 'numeric', 'min:0', 'max:100'],
            'standard_payment' => ['sometimes', 'numeric', 'gt:0'],
            'term_months' => ['sometimes', 'integer', 'min:1', 'max:600'],
            'payment_schedule' => ['sometimes', 'nullable', 'array'],
            'payment_schedule.*.from_month' => ['required_with:payment_schedule', 'integer', 'min:1', 'max:600'],
            'payment_schedule.*.to_month' => ['required_with:payment_schedule', 'integer', 'min:1', 'max:600'],
            'payment_schedule.*.amount' => ['required_with:payment_schedule', 'numeric', 'gt:0'],
            'start_date' => ['sometimes', 'date'],
            'first_payment_date' => ['sometimes', 'date'],
            'recalculation_mode' => ['sometimes', 'in:TERM,PAYMENT'],
            'status' => ['sometimes', 'in:ACTIVE,CLOSED'],
        ]);

        $effectiveStartDate = Carbon::parse($data['start_date'] ?? $credit->start_date);
        $effectiveFirstPaymentDate = Carbon::parse($data['first_payment_date'] ?? $credit->first_payment_date);
        if ($effectiveFirstPaymentDate->lt($effectiveStartDate)) {
            return response()->json(['message' => 'First payment date cannot be before the credit start date.'], 422);
        }

        if (array_key_exists('payment_schedule', $data) && !empty($data['payment_schedule'])) {
            $effectiveTermMonths = (int) ($data['term_months'] ?? $credit->term_months);
            $expectedMonth = 1;
            foreach ($data['payment_schedule'] as $index => $segment) {
                $from = (int) $segment['from_month'];
                $to = (int) $segment['to_month'];
                if ($from !== $expectedMonth) {
                    return response()->json(['message' => "Payment schedule row #" . ($index + 1) . ": expected from_month {$expectedMonth}."], 422);
                }
                if ($from > $to) {
                    return response()->json(['message' => "Payment schedule row #" . ($index + 1) . ": from_month must be <= to_month."], 422);
                }
                if ($to > $effectiveTermMonths) {
                    return response()->json(['message' => "Payment schedule row #" . ($index + 1) . ": to_month cannot exceed term_months."], 422);
                }
                $expectedMonth = $to + 1;
            }
            if ($expectedMonth !== ($effectiveTermMonths + 1)) {
                return response()->json(['message' => 'Payment schedule must cover all months of the loan term.'], 422);
            }
        }

        $earliestPrepayment = $credit->prepayments()->min('paid_on');
        if ($earliestPrepayment && $effectiveFirstPaymentDate->gt(Carbon::parse($earliestPrepayment))) {
            return response()->json(['message' => 'First payment date cannot be moved after an existing historical prepayment.'], 422);
        }

        $credit->update($data);
        return response()->json(['data' => $credit->fresh()->load(['prepayments' => fn ($query) => $query->orderBy('paid_on')])]);
    }

    public function destroy(Request $request, Credit $credit): JsonResponse
    {
        $membership = $this->membership($request, $credit->family_id);
        $this->assertAdmin($membership);
        $credit->delete();
        return response()->json([], 204);
    }

    public function storePrepayment(Request $request, Credit $credit): JsonResponse
    {
        $membership = $this->membership($request, $credit->family_id);
        $this->assertAdmin($membership);

        $data = $request->validate([
            'amount' => ['required', 'numeric', 'gt:0'],
            'paid_on' => ['required', 'date', 'after_or_equal:' . $credit->start_date, 'before_or_equal:today'],
            'comment' => ['nullable', 'string', 'max:255'],
        ]);

        $prepayment = CreditPrepayment::create([
            ...$data,
            'credit_id' => $credit->id,
            'created_by' => $membership->user_id,
        ]);

        return response()->json(['data' => $prepayment], 201);
    }

    public function destroyPrepayment(Request $request, CreditPrepayment $prepayment): JsonResponse
    {
        $credit = $prepayment->credit;
        $membership = $this->membership($request, $credit->family_id);
        $this->assertAdmin($membership);
        $prepayment->delete();
        return response()->json([], 204);
    }
}
