<?php

namespace App\Console\Commands;

use App\Models\Event;
use App\Models\FamilyMember;
use App\Services\Notifications\TelegramNotificationService;
use Illuminate\Console\Command;

class SendEventNotifications extends Command
{
    protected $signature = 'family:send-event-notifications';
    protected $description = 'Notify family members 30 minutes before scheduled events';

    public function handle(): int
    {
        $from = now()->addMinutes(29);
        $to = now()->addMinutes(30);
        $events = Event::where('status', 'SCHEDULED')->whereBetween('start_at', [$from, $to])->get();
        foreach ($events as $event) {
            foreach (FamilyMember::where('family_id', $event->family_id)->where('status', 'ACTIVE')->get() as $member) {
                TelegramNotificationService::notifyEventReminder($event, $member);
            }
        }
        $this->info("Processed {$events->count()} upcoming events.");
        return self::SUCCESS;
    }
}
