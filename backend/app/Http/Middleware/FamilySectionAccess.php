<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class FamilySectionAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        $section = match ($request->segment(3)) {
            'events', 'reminders' => 'calendar',
            'lists', 'planned-purchases' => 'shopping',
            'finance', 'finances', 'credits', 'credit-prepayments' => 'finance',
            default => null,
        };
        if ($section !== null) {
            $member = $request->user()->familyMembers()->where('status', 'ACTIVE')->first();
            if (!$member) return response()->json(['message' => 'Active family membership required.'], 403);
            if (!$member->canViewSection($section)) {
                return response()->json(['message' => 'Администратор ограничил доступ к этому разделу.', 'code' => 'SECTION_HIDDEN', 'section' => $section], 403);
            }
        }
        return $next($request);
    }
}
