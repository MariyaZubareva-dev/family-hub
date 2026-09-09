<?php

namespace App\Http\Controllers\Api;

use App\Services\Finance\FinanceOverviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FinanceOverviewController extends FinanceBaseController
{
    public function show(Request $request, FinanceOverviewService $overview): JsonResponse
    {
        $membership = $this->adminMembership($request);
        $year = (int) $request->integer('year', now($membership->user->timezone ?: 'Europe/Moscow')->year);
        $month = (int) $request->integer('month', now($membership->user->timezone ?: 'Europe/Moscow')->month);
        abort_unless($year >= 2000 && $year <= 2200 && $month >= 1 && $month <= 12, 422, 'Invalid finance period.');

        return response()->json(['data' => $overview->build($membership, $year, $month)]);
    }
}
