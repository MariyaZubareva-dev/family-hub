<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class BootstrapQaEmailLogin extends Command
{
    protected $signature = 'family:qa-email-login {telegramId : Existing QA Telegram user ID}';
    protected $description = 'Provision email login for an existing QA user, without SMTP (interactive, non-production only)';

    public function handle(): int
    {
        // This emergency QA workflow must never be available on production or on the real family DB.
        if (!app()->environment(['local', 'testing', 'staging'])) {
            $this->error('Only local/testing/staging environments are supported.');
            return self::FAILURE;
        }
        if (config('app.url') === 'https://teamportal.ru') {
            $this->error('Refusing to modify the production application URL.');
            return self::FAILURE;
        }

        $user = User::where('telegram_user_id', $this->argument('telegramId'))->first();
        if (!$user) {
            $this->error('User not found. The command never creates an account.');
            return self::FAILURE;
        }

        $email = Str::lower(trim((string) $this->ask('QA email address')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
            $this->error('Invalid email.');
            return self::FAILURE;
        }
        if (User::where('email', $email)->where('id', '!=', $user->getKey())->exists()) {
            $this->error('Email is already assigned to another user.');
            return self::FAILURE;
        }

        $password = (string) $this->secret('New QA password (12–128 characters)');
        if (strlen($password) < 12 || strlen($password) > 128) {
            $this->error('The password must be 12–128 characters.');
            return self::FAILURE;
        }
        $confirmPassword = (string) $this->secret('Repeat QA password');
        if (!hash_equals($password, $confirmPassword)) {
            $this->error('Passwords do not match.');
            return self::FAILURE;
        }

        $this->warn("Existing user ID: {$user->id}. The current family membership remains unchanged.");
        if (!$this->confirm('This is an isolated QA database and you control the email. Continue?', false)) {
            $this->line('Cancelled.');
            return self::FAILURE;
        }

        DB::transaction(function () use ($user, $email, $password): void {
            $user->update([
                'email' => $email,
                'password' => Hash::make($password),
                'email_verified_at' => now(),
            ]);
            DB::table('browser_sessions')->where('user_id', $user->id)->delete();
            DB::table('email_verification_codes')->where('user_id', $user->id)->delete();
        });

        $this->info('QA email login enabled for the existing user. Credentials were not printed or stored in source control.');
        return self::SUCCESS;
    }
}
