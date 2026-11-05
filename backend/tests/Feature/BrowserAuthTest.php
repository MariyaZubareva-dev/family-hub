<?php

namespace Tests\Feature;

use App\Models\Family;
use App\Models\FamilyInvitation;
use App\Models\FamilyMember;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class BrowserAuthTest extends TestCase
{
    use RefreshDatabase;

    private function codeFor(User $user, string $code = '123456'): void
    {
        DB::table('email_verification_codes')->updateOrInsert(
            ['user_id' => $user->id],
            ['code_hash' => hash('sha256', $code), 'expires_at' => now()->addMinutes(10),
             'attempts' => 0, 'created_at' => now(), 'updated_at' => now()]
        );
    }

    public function test_email_only_user_can_register_verify_and_login(): void
    {
        config(['mail.default' => 'log']);
        $this->postJson('/api/v1/auth/register', [
            'email' => 'test@example.com', 'password' => 'strong-test-password-123',
            'first_name' => 'Новый участник',
        ])->assertCreated();
        $user = User::where('email', 'test@example.com')->firstOrFail();
        $this->assertNull($user->telegram_user_id);
        $this->assertTrue(Hash::check('strong-test-password-123', $user->password));
        $this->postJson('/api/v1/auth/login', [
            'email' => 'test@example.com', 'password' => 'strong-test-password-123',
        ])->assertUnprocessable();

        $this->codeFor($user);
        $this->postJson('/api/v1/auth/verify', [
            'email' => 'test@example.com', 'code' => '123456',
        ])->assertOk();

        $login = $this->postJson('/api/v1/auth/login', [
            'email' => 'test@example.com', 'password' => 'strong-test-password-123',
        ])->assertOk()->assertJsonStructure(['data' => ['csrf', 'user' => ['id']]]);
        $token = $login->headers->getCookies()[0]->getValue();
        $csrf = $login->json('data.csrf');

        $this->withCookie('fh_browser_session', $token)
            ->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.id', $user->id);
        $this->withCookie('fh_browser_session', $token)
            ->postJson('/api/v1/families', ['name' => 'Наша семья'])->assertStatus(419);
        $this->withCookie('fh_browser_session', $token)->withHeader('X-Family-CSRF', $csrf)
            ->postJson('/api/v1/families', ['name' => 'Наша семья'])->assertCreated();

        // Session termination must revoke the server-side token.
        $this->withCookie('fh_browser_session', $token)->withHeader('X-Family-CSRF', $csrf)
            ->postJson('/api/v1/auth/logout')->assertOk();
        $this->withCookie('fh_browser_session', $token)
            ->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_password_reset_revokes_browser_sessions(): void
    {
        $user = User::create([
            'first_name' => 'Участник', 'email' => 'reset@example.com',
            'email_verified_at' => now(), 'password' => Hash::make('original-password-123'),
        ]);
        $old = $this->postJson('/api/v1/auth/login', [
            'email' => 'reset@example.com', 'password' => 'original-password-123',
        ])->assertOk();
        $token = $old->headers->getCookies()[0]->getValue();
        $this->codeFor($user);
        $this->postJson('/api/v1/auth/password/reset', [
            'email' => 'reset@example.com', 'code' => '123456',
            'password' => 'brand-new-password-789',
        ])->assertOk();
        $this->withCookie('fh_browser_session', $token)
            ->getJson('/api/v1/me')->assertUnauthorized();
        $this->postJson('/api/v1/auth/login', [
            'email' => 'reset@example.com', 'password' => 'original-password-123',
        ])->assertUnprocessable();
        $this->postJson('/api/v1/auth/login', [
            'email' => 'reset@example.com', 'password' => 'brand-new-password-789',
        ])->assertOk();
    }

    public function test_email_user_does_not_receive_telegram_invitations_with_null_id(): void
    {
        $admin = User::create(['telegram_user_id' => 20001, 'first_name' => 'Админ']);
        $family = Family::create(['name' => 'Семья', 'created_by' => $admin->id]);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $admin->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        FamilyInvitation::create([
            'family_id' => $family->id, 'invited_by' => $admin->id,
            'username' => 'anotherperson', 'telegram_user_id' => null,
            'status' => FamilyInvitation::PENDING,
            'expires_at' => now()->addDays(7),
        ]);
        $emailUser = User::create([
            'first_name' => 'Email', 'email' => 'member@example.com',
            'email_verified_at' => now(), 'password' => Hash::make('strong-password-123'),
        ]);
        $this->actingAs($emailUser)->getJson('/api/v1/family/invitations')->assertOk()->assertJsonCount(0, 'data');
    }
}
