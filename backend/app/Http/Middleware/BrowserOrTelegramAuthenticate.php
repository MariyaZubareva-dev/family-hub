<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class BrowserOrTelegramAuthenticate
{
    public function __construct(private TelegramAuthenticate $telegram) {}

    public function handle(Request $request, Closure $next): Response
    {
        // Telegram's signed initData always takes precedence inside Telegram.
        if ($request->header('X-Telegram-Init-Data')) {
            return $this->telegram->handle($request, $next);
        }
        $token = $request->cookie('fh_browser_session');
        if ($token && preg_match('/^[a-f0-9]{64}$/D', $token)) {
            $session = DB::table('browser_sessions')
                ->where('token_hash', hash('sha256', $token))
                ->where('expires_at', '>', now())
                ->first();
            if ($session) {
                $user = User::find($session->user_id);
                if ($user && $user->email_verified_at) {
                    if (!in_array($request->method(), ['GET', 'HEAD', 'OPTIONS'], true)) {
                        $csrf = $request->header('X-Family-CSRF');
                        if (!is_string($csrf) || !hash_equals($session->csrf_hash, hash('sha256', $csrf))) {
                            return response()->json(['message' => 'Проверка безопасности не пройдена. Перезагрузите приложение.'], 419);
                        }
                        $origin = $request->headers->get('Origin');
                        if ($origin && parse_url($origin, PHP_URL_HOST) !== $request->getHost()) {
                            return response()->json(['message' => 'Invalid origin.'], 403);
                        }
                    }
                    $request->setUserResolver(fn () => $user);
                    return $next($request);
                }
            }
        }

        // Local-only test login is retained for the existing QA workflow.
        if (app()->environment('local') && $request->header('X-Dev-Telegram-User-Id')) {
            return $this->telegram->handle($request, $next);
        }
        return response()->json(['message' => 'Требуется вход в Family Hub.', 'code' => 'UNAUTHENTICATED'], 401);
    }
}
