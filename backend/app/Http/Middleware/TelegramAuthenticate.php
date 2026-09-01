<?php

namespace App\Http\Middleware;

use App\Models\Family;
use App\Models\FamilyMember;
use App\Models\User;
use App\Services\Telegram\TelegramInitDataValidator;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class TelegramAuthenticate
{
    public function __construct(private readonly TelegramInitDataValidator $validator) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (app()->environment('local')) {
            $devId = $request->header('X-Dev-Telegram-User-Id');
            if ($devId) {
                $user = User::where('telegram_user_id', $devId)->first();
                if (!$user) {
                    return response()->json(['message' => 'Development user not found.'], 401);
                }
                $request->setUserResolver(fn () => $user);
                return $next($request);
            }
        }

        $initData = $request->header('X-Telegram-Init-Data');
        if (!$initData) {
            return response()->json(['message' => 'Telegram authentication data is missing.'], 401);
        }

        try {
            $data = $this->validator->validate($initData);
            $tgUser = $data['user'] ?? null;
            if (!is_array($tgUser) || empty($tgUser['id'])) {
                return response()->json(['message' => 'Telegram user data is missing.'], 401);
            }

            $user = User::updateOrCreate(
                ['telegram_user_id' => (int) $tgUser['id']],
                [
                    'username' => $tgUser['username'] ?? null,
                    'first_name' => $tgUser['first_name'] ?? 'Unknown',
                    'last_name' => $tgUser['last_name'] ?? null,
                    'avatar_url' => $tgUser['photo_url'] ?? null,
                ]
            );

            $request->setUserResolver(fn () => $user);
            return $next($request);
        } catch (Throwable $e) {
            report($e);
            return response()->json(['message' => 'Telegram authentication failed.'], 401);
        }
    }
}
