<?php

namespace Tests\Feature;

use App\Http\Middleware\TelegramAuthenticate;
use App\Jobs\SendFamilyInvitation;
use App\Models\Family;
use App\Models\FamilyInvitation;
use App\Models\FamilyMember;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class FamilyInvitationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Http::preventStrayRequests();
        $this->withoutMiddleware(TelegramAuthenticate::class);
    }

    private function invitation(array $attributes = []): FamilyInvitation
    {
        $admin = User::create(['telegram_user_id' => 20001, 'first_name' => 'Мария']);
        $family = Family::create(['name' => 'Наша семья', 'created_by' => $admin->id]);
        FamilyMember::create(['family_id' => $family->id, 'user_id' => $admin->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        return FamilyInvitation::create(array_merge(['family_id' => $family->id, 'invited_by' => $admin->id,
            'telegram_user_id' => 20002, 'status' => FamilyInvitation::PENDING, 'expires_at' => now()->addDays(14)], $attributes));
    }

    public function test_user_without_family_can_find_and_accept_invitation(): void
    {
        $invitation = $this->invitation();
        $user = User::create(['telegram_user_id' => 20002, 'first_name' => 'Андрей']);
        $this->actingAs($user)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.family', null);
        $this->getJson('/api/v1/family/invitations')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $invitation->id);
        $this->postJson("/api/v1/family/invitations/{$invitation->id}/accept")->assertOk();
        $this->getJson('/api/v1/family')->assertOk()->assertJsonPath('data.id', $invitation->family_id)->assertJsonPath('data.my_role', 'USER');
        $this->getJson('/api/v1/family/invitations')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_invitation_by_unknown_username_can_be_found_and_accepted(): void
    {
        $seed = $this->invitation(['status' => FamilyInvitation::REVOKED]);
        $response = $this->actingAs($seed->inviter)->postJson('/api/v1/family/invitations', ['username' => '@NewPerson'])
            ->assertCreated()->assertJsonPath('data.telegram_user_id', null);
        $user = User::create(['telegram_user_id' => 20003, 'username' => 'newperson', 'first_name' => 'Новый участник']);
        $this->actingAs($user)->getJson('/api/v1/family/invitations')->assertOk()->assertJsonCount(1, 'data');
        $this->postJson('/api/v1/family/invitations/' . $response->json('data.id') . '/accept')->assertOk();
        Queue::assertNothingPushed();
    }

    public function test_creation_by_id_queues_telegram_message(): void
    {
        $seed = $this->invitation(['status' => FamilyInvitation::REVOKED]);
        $response = $this->actingAs($seed->inviter)->postJson('/api/v1/family/invitations', ['telegram_user_id' => 20003])->assertCreated();
        Queue::assertPushed(SendFamilyInvitation::class, fn ($job) => $job->invitationId === $response->json('data.id') && $job->queue === 'notifications');
    }

    public function test_bound_invitation_cannot_be_claimed_by_reused_username(): void
    {
        $invitation = $this->invitation(['username' => 'oldname']);
        $other = User::create(['telegram_user_id' => 20004, 'username' => 'oldname', 'first_name' => 'Другой']);
        $this->actingAs($other)->getJson('/api/v1/family/invitations')->assertOk()->assertJsonCount(0, 'data');
        $this->postJson("/api/v1/family/invitations/{$invitation->id}/accept")->assertForbidden();
        $this->assertDatabaseMissing('family_members', ['user_id' => $other->id]);
    }

    public function test_expired_invitation_is_hidden_and_cannot_be_accepted(): void
    {
        $invitation = $this->invitation(['expires_at' => now()->subMinute()]);
        $user = User::create(['telegram_user_id' => 20002, 'first_name' => 'Андрей']);
        $this->actingAs($user)->getJson('/api/v1/family/invitations')->assertOk()->assertJsonCount(0, 'data');
        $this->postJson("/api/v1/family/invitations/{$invitation->id}/accept")->assertStatus(409);
    }

    public function test_api_returns_json_errors_without_accept_header(): void
    {
        $user = User::create(['telegram_user_id' => 20002, 'first_name' => 'Андрей']);
        $this->actingAs($user)->get('/api/v1/family')->assertForbidden()->assertJsonPath('message', 'Active family membership required.');
    }

    public function test_job_sends_private_invitation_with_open_button_only_once(): void
    {
        $invitation = $this->invitation();
        config(['services.telegram.bot_token' => 'test_token', 'app.url' => 'https://teamportal.ru']);
        Http::fake(['api.telegram.org/*' => Http::response(['ok' => true, 'result' => ['message_id' => 1]])]);
        $job = new SendFamilyInvitation($invitation->id);
        $job->handle();
        $job->handle();
        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => (int) $request['chat_id'] === 20002
            && str_contains($request['text'], 'Наша семья')
            && $request['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] === 'https://teamportal.ru/?section=family');
    }

    public function test_revoked_invitation_does_not_send_telegram_message(): void
    {
        $invitation = $this->invitation(['status' => FamilyInvitation::REVOKED]);
        (new SendFamilyInvitation($invitation->id))->handle();
        Http::assertNothingSent();
    }
}
