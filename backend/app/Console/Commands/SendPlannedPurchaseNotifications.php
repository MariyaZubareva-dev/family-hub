<?php

namespace App\Console\Commands;

use App\Models\PlannedPurchase;
use App\Services\Notifications\TelegramNotificationService;
use Illuminate\Console\Command;

class SendPlannedPurchaseNotifications extends Command
{
    protected $signature = 'family:send-purchase-notifications';
    protected $description = 'Notify families before planned recurring purchases are due';

    public function handle(): int
    {
        $purchases = PlannedPurchase::where('type', 'RECURRING')
            ->where('status', 'ACTIVE')
            ->whereNotNull('due_date')
            ->whereBetween('due_date', [today(), today()->addDays(90)])
            ->get()
            ->filter(fn (PlannedPurchase $purchase) => $purchase->due_date->isSameDay(today()->addDays((int) $purchase->notify_days_before)));

        foreach ($purchases as $purchase) TelegramNotificationService::notifyPlannedPurchaseDue($purchase);
        $this->info("Queued notifications for {$purchases->count()} planned purchases.");
        return self::SUCCESS;
    }
}
