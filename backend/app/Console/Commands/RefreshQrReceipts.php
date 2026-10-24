<?php

namespace App\Console\Commands;

use App\Services\Finance\ReceiptQrRefresh;
use Illuminate\Console\Command;

class RefreshQrReceipts extends Command
{
    protected $signature='family:refresh-qr-receipts';
    protected $description='Fetch electronic receipts that are still waiting for fiscal data';

    public function handle(ReceiptQrRefresh $refresh): int
    {
        $this->info('Updated receipts: '.$refresh->run());
        return self::SUCCESS;
    }
}
