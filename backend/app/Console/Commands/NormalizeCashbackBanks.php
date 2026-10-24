<?php
namespace App\Console\Commands;
use App\Services\Finance\NormalizeCashbackBanks as Normalizer;
use Illuminate\Console\Command;
class NormalizeCashbackBanks extends Command
{
    protected $signature='family:normalize-cashback-banks {--apply : Apply changes and save original snapshots}';
    protected $description='Audit bank names and merge known aliases within one family, owner and month';
    public function handle(Normalizer $normalizer): int {$this->line(json_encode($normalizer->run((bool)$this->option('apply')),JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT));return self::SUCCESS;}
}
