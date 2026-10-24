<?php

namespace App\Console\Commands;

use App\Services\Finance\FiscalQr;
use Illuminate\Console\Command;

class CheckReceiptQr extends Command
{
    protected $signature = 'family:check-receipt-qr';
    protected $description = 'Check actual QR decoding without a provider request or personal receipt';

    public function handle(FiscalQr $decoder): int
    {
        // Synthetic fixture: no API call, credentials or user data are needed.
        $image = 'data:image/png;base64,'.trim(file_get_contents(resource_path('diagnostics/fiscal-qr.png.b64')));
        $expected = ['t'=>'20261022T100000','s'=>'199.80','fn'=>'9286000100012345','i'=>'123','fp'=>'4567','n'=>'1'];
        $ok = $decoder->decode($image) === $expected;
        $this->line(json_encode(['QR_DECODE_OK'=>$ok]));
        return $ok ? self::SUCCESS : self::FAILURE;
    }
}
