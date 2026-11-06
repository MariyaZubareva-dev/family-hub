<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class BrowserAuthController extends Controller
{
    private function credentials(Request $request): array
    {
        return $request->validate([
            'email' => ['required', 'email:rfc', 'max:254'],
            'password' => ['required', 'string', 'min:12', 'max:128'],
        ]);
    }

    private function issueVerification(User $user, ?string $pendingEmail = null, ?string $pendingPasswordHash = null): void
    {
        $code = (string) random_int(100000, 999999);
        DB::table('email_verification_codes')->updateOrInsert(
            ['user_id' => $user->id],
            ['code_hash' => hash('sha256', $code), 'pending_email' => $pendingEmail, 'pending_password_hash' => $pendingPasswordHash,
             'expires_at' => now()->addMinutes(10), 'attempts' => 0, 'created_at' => now(), 'updated_at' => now()]
        );
        Mail::raw("Код подтверждения Family Hub: {$code}\nОн действует 10 минут. Если вы не запрашивали код, проигнорируйте письмо.", function ($mail) use ($user, $pendingEmail) {
            $mail->to($pendingEmail ?? $user->email)->subject('Подтверждение email — Family Hub');
        });
    }

    public function register(Request $request): JsonResponse
    {
        $data = $this->credentials($request);
        $details = $request->validate(['first_name' => ['required', 'string', 'max:100']]);
        $email = Str::lower(trim($data['email']));
        if (User::where('email', $email)->exists()) {
            throw ValidationException::withMessages(['email' => 'Этот адрес уже зарегистрирован.']);
        }
        $user = User::create([
            'email' => $email, 'password' => Hash::make($data['password']),
            'first_name' => $details['first_name'], 'timezone' => 'Europe/Moscow',
        ]);
        try {
            $this->issueVerification($user);
        } catch (\Throwable $e) {
            report($e);
            return response()->json(['message' => 'Учётная запись создана, но отправить код не удалось. Обратитесь к администратору.'], 503);
        }
        return response()->json(['message' => 'Код подтверждения отправлен на почту.'], 201);
    }

    public function link(Request $request): JsonResponse
    {
        if (!$request->header('X-Telegram-Init-Data')) {
            return response()->json(['message' => 'Привязка доступна только при входе через Telegram.'], 403);
        }
        $data = $this->credentials($request);
        $email = Str::lower(trim($data['email']));
        $user = $request->user();
        if (!$user->telegram_user_id) return response()->json(['message' => 'Необходим Telegram-аккаунт.'], 403);
        if (User::where('email', $email)->where('id', '!=', $user->id)->exists()) {
            throw ValidationException::withMessages(['email' => 'Этот email уже используется.']);
        }
        if (DB::table('email_verification_codes')->where('pending_email', $email)
            ->where('user_id', '!=', $user->id)->where('expires_at', '>', now())->exists()) {
            throw ValidationException::withMessages(['email' => 'Этот адрес ожидает подтверждения другим пользователем.']);
        }
        // Existing login and confirmed address remain valid until the new email is verified.
        $this->issueVerification($user, $email, Hash::make($data['password']));
        return response()->json(['message' => 'Код подтверждения отправлен на почту.']);
    }

    public function resend(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required','email:rfc']]);
        $email = Str::lower(trim($data['email']));
        $user = User::where('email', $email)->whereNull('email_verified_at')->first();
        $pending = DB::table('email_verification_codes')->where('pending_email', $email)->where('expires_at', '>', now())->first();
        // Do not disclose whether an account exists.
        if ($user) $this->issueVerification($user);
        elseif ($pending && ($linked = User::find($pending->user_id))) {
            $this->issueVerification($linked, $pending->pending_email, $pending->pending_password_hash);
        }
        return response()->json(['message' => 'Если адрес ожидает подтверждения, новый код отправлен.']);
    }

    public function verify(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email:rfc'], 'code' => ['required', 'digits:6']]);
        $email = Str::lower(trim($data['email']));
        $user = User::where('email', $email)->first();
        $pending = DB::table('email_verification_codes')->where('pending_email', $email)->first();
        if (!$user && $pending) $user = User::find($pending->user_id);
        $record = $user ? DB::table('email_verification_codes')->where('user_id', $user->id)->first() : null;
        if (!$record || $record->attempts >= 5 || now()->greaterThan($record->expires_at) ||
            !hash_equals($record->code_hash, hash('sha256', $data['code']))) {
            if ($record) DB::table('email_verification_codes')->where('user_id', $user->id)->increment('attempts');
            throw ValidationException::withMessages(['code' => 'Неверный или просроченный код.']);
        }
        DB::transaction(function () use ($user, $record) {
            if ($record->pending_email && $record->pending_password_hash) {
                if (User::where('email', $record->pending_email)->where('id', '!=', $user->id)->exists()) {
                    throw ValidationException::withMessages(['email' => 'Этот адрес уже зарегистрирован.']);
                }
                $user->update([
                    'email' => $record->pending_email,
                    'password' => $record->pending_password_hash,
                    'email_verified_at' => now(),
                ]);
                DB::table('browser_sessions')->where('user_id', $user->id)->delete();
            } else {
                $user->update(['email_verified_at' => now()]);
            }
            DB::table('email_verification_codes')->where('user_id', $user->id)->delete();
        });
        return response()->json(['message' => 'Адрес подтверждён. Теперь можно войти по email.']);
    }

    public function requestPasswordReset(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email:rfc']]);
        $user = User::where('email', Str::lower(trim($data['email'])))->whereNotNull('email_verified_at')->first();
        if ($user) $this->issueVerification($user);
        return response()->json(['message' => 'Если email зарегистрирован, на него отправлен код восстановления.']);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email:rfc'],
            'code' => ['required', 'digits:6'],
            'password' => ['required', 'string', 'min:12', 'max:128'],
        ]);
        $user = User::where('email', Str::lower(trim($data['email'])))->whereNotNull('email_verified_at')->first();
        $record = $user ? DB::table('email_verification_codes')->where('user_id', $user->id)->first() : null;
        if (!$record || $record->attempts >= 5 || now()->greaterThan($record->expires_at) ||
            !hash_equals($record->code_hash, hash('sha256', $data['code']))) {
            if ($record) DB::table('email_verification_codes')->where('user_id', $user->id)->increment('attempts');
            throw ValidationException::withMessages(['code' => 'Неверный или просроченный код.']);
        }
        DB::transaction(function () use ($user, $data) {
            $user->update(['password' => Hash::make($data['password'])]);
            DB::table('email_verification_codes')->where('user_id', $user->id)->delete();
            DB::table('browser_sessions')->where('user_id', $user->id)->delete();
        });
        return response()->json(['message' => 'Пароль изменён. Войди с новым паролем.']);
    }

    public function login(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email:rfc'], 'password' => ['required', 'string']]);
        $email = Str::lower(trim($data['email']));
        $user = User::where('email', $email)->first();
        if (!$user || !$user->email_verified_at || !$user->password || !Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => 'Неверный email или пароль либо адрес не подтверждён.']);
        }
        $token = bin2hex(random_bytes(32));
        $csrf = bin2hex(random_bytes(32));
        DB::table('browser_sessions')->insert([
            'token_hash' => hash('sha256', $token),
            'csrf_hash' => hash('sha256', $csrf),
            'user_id' => $user->id,
            'expires_at' => now()->addDays(30),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $secure = !app()->environment('local');
        $cookie = cookie('fh_browser_session', $token, 60 * 24 * 30, '/', null, $secure, true, false, 'lax');
        return response()->json(['data' => ['csrf' => $csrf, 'user' => ['id' => $user->id, 'first_name' => $user->first_name]]])->cookie($cookie);
    }

    public function session(Request $request): JsonResponse
    {
        $token = $request->cookie('fh_browser_session');
        if (!$token || !preg_match('/^[a-f0-9]{64}$/D', $token)) return response()->json(['authenticated' => false], 401);
        $session = DB::table('browser_sessions')->where('token_hash', hash('sha256', $token))->where('expires_at', '>', now())->first();
        if (!$session || !User::whereKey($session->user_id)->whereNotNull('email_verified_at')->exists()) return response()->json(['authenticated' => false], 401);
        $csrf = bin2hex(random_bytes(32));
        DB::table('browser_sessions')->where('token_hash', $session->token_hash)->update(['csrf_hash' => hash('sha256', $csrf), 'updated_at' => now()]);
        return response()->json(['authenticated' => true, 'csrf' => $csrf]);
    }

    public function logout(Request $request): JsonResponse
    {
        $token = $request->cookie('fh_browser_session');
        if ($token) DB::table('browser_sessions')->where('token_hash', hash('sha256', $token))->delete();
        return response()->json(['message' => 'Вы вышли из Family Hub.'])
            ->cookie(cookie()->forget('fh_browser_session'));
    }
}
