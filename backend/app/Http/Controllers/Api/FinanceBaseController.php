<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class FinanceBaseController extends BaseApiController
{
    protected function adminMembership(Request $request)
    {
        $m = $this->membership($request);
        $this->assertAdmin($m);
        return $m;
    }

    // Allow any active family member to view analytics/receipts (read), not just ADMIN.
    // Use membership() for read, adminMembership() for write.
    protected function viewMembership(Request $request)
    {
        return $this->membership($request);
    }

    protected function activeCategory(string $familyId, string $categoryId): object
    {
        $cat = DB::table('expense_categories')->where('id', $categoryId)->where('family_id', $familyId)->where('status', 'ACTIVE')->first();
        abort_unless($cat, 404, 'Category not found');
        return $cat;
    }

    protected function resolveCategoryId(string $familyId, ?string $categoryName, ?string $categoryId): ?string
    {
        if ($categoryId) {
            $this->activeCategory($familyId, $categoryId);
            return $categoryId;
        }
        if ($categoryName) {
            $cat = DB::table('expense_categories')->where('family_id', $familyId)->where('name', $categoryName)->where('status','ACTIVE')->first();
            if ($cat) return $cat->id;
            // Fallback: try case-insensitive
            $cat = DB::table('expense_categories')->where('family_id', $familyId)->whereRaw('LOWER(name)=?', [mb_strtolower($categoryName)])->where('status','ACTIVE')->first();
            if ($cat) return $cat->id;
        }
        return null;
    }
}
