<?php

namespace App\Console\Commands;

use App\Models\Family;
use App\Services\StoreListService;
use Illuminate\Console\Command;

class SyncStoreList extends Command
{
    protected $signature='family:sync-store-list';
    protected $description='Add due recurring purchases to family store lists';
    public function handle(StoreListService $service): int
    {
        $count=0;
        Family::whereIn('id',fn($q)=>$q->select('family_id')->from('planned_purchases')->where('type','RECURRING')->where('status','ACTIVE')->whereNull('deleted_at')->whereNotNull('due_date'))
            ->chunkById(100,function($families)use($service,&$count){foreach($families as $family)$count+=$service->sync($family->id);});
        $this->info('Added store items: '.$count); return self::SUCCESS;
    }
}
