<?php

namespace App\Observers;

use App\Models\Event;
use App\Services\Notifications\TelegramNotificationService;
use Illuminate\Support\Facades\Log;

class EventObserver
{
    public function created(Event $event): void
    {
        try {
            TelegramNotificationService::notifyEventCreated($event);
        } catch (\Throwable $e) {
            Log::warning('EventObserver created failed', ['event_id' => $event->id, 'error' => $e->getMessage()]);
        }
    }

    public function updated(Event $event): void
    {
        try {
            if ($event->wasChanged('status') && $event->status === 'CANCELLED') {
                TelegramNotificationService::notifyEventCancelled($event);
            } else {
                TelegramNotificationService::notifyEventChanged($event);
            }
        } catch (\Throwable $e) {
            Log::warning('EventObserver updated failed', ['event_id' => $event->id, 'error' => $e->getMessage()]);
        }
    }

    public function deleted(Event $event): void
    {
        try {
            TelegramNotificationService::notifyEventCancelled($event);
        } catch (\Throwable $e) {
            Log::warning('EventObserver deleted failed', ['event_id' => $event->id, 'error' => $e->getMessage()]);
        }
    }
}
