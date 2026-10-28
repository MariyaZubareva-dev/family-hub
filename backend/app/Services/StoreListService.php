<?php

namespace App\Services;

use App\Models\{Family,PlannedPurchase,StoreListItem};
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class StoreListService
{
    public function today(string $familyId): string
    {
        return Carbon::now(Family::findOrFail($familyId)->timezone ?: 'Europe/Moscow')->toDateString();
    }

    public function sync(string $familyId): int
    {
        $today=$this->today($familyId); $created=0;
        PlannedPurchase::where('family_id',$familyId)->where('type','RECURRING')->where('status','ACTIVE')
            ->whereNotNull('cadence_months')->whereDate('due_date','<=',$today)->orderBy('id')->chunkById(100,function($purchases)use($familyId,&$created,$today){
                foreach($purchases as $purchase) DB::transaction(function()use($purchase,$familyId,&$created,$today){
                    // Lock the source first everywhere (sync, checkbox and regular-purchase actions).
                    $source=PlannedPurchase::whereKey($purchase->id)->lockForUpdate()->first();
                    if(!$source || $source->status!=='ACTIVE' || $source->type!=='RECURRING' || !$source->cadence_months || !$source->due_date || $source->due_date->toDateString()>$today)return;
                    if(StoreListItem::where('recurring_purchase_id',$source->id)->where('is_completed',false)->exists())return;
                    $created+=DB::table('store_list_items')->insertOrIgnore([
                        'id'=>(string)Str::ulid(),'family_id'=>$familyId,'created_by'=>$source->created_by,'name'=>$source->name,
                        'recurring_purchase_id'=>$source->id,'recurring_due_date'=>$source->due_date->toDateString(),'notes'=>$source->notes?mb_substr($source->notes,0,500):null,
                        'quantity'=>($source->quantity ?: 1).' шт.',
                        'is_completed'=>false,'created_at'=>now(),'updated_at'=>now(),
                    ]);
                });
            });
        return $created;
    }

    public function update(StoreListItem $item, array $data, string $userId): StoreListItem
    {
        $today=$this->today($item->family_id);
        if(array_key_exists('is_completed',$data))$data['is_completed']=(bool)$data['is_completed'];
        return DB::transaction(function()use($item,$data,$userId,$today){
            $source=$item->recurring_purchase_id ? PlannedPurchase::where('family_id',$item->family_id)->whereKey($item->recurring_purchase_id)->lockForUpdate()->first() : null;
            $row=StoreListItem::whereKey($item->id)->lockForUpdate()->firstOrFail();
            $changed=array_key_exists('is_completed',$data) && $data['is_completed']!==$row->is_completed;
            if($changed){
                $completed=$data['is_completed'];
                $data['completed_by']=$completed?$userId:null; $data['completed_at']=$completed?now():null;
                if($source && $source->status==='ACTIVE' && $source->type==='RECURRING' && $source->cadence_months){
                    if($completed && $source->due_date?->toDateString()===$row->recurring_due_date?->toDateString()){
                        $next=Carbon::parse($today)->addMonthsNoOverflow((int)$source->cadence_months)->toDateString();
                        $data+=['previous_purchased_on'=>$source->last_purchased_at?->toDateString(),'purchased_on'=>$today,'rescheduled_due_date'=>$next,'schedule_revision'=>(int)$source->purchase_revision+1];
                        $source->update(['last_purchased_at'=>$today,'due_date'=>$next,'purchase_revision'=>(int)$source->purchase_revision+1]);
                    }elseif(!$completed && $row->schedule_revision!==null && (int)$source->purchase_revision===$row->schedule_revision
                        && !StoreListItem::withTrashed()->where('recurring_purchase_id',$source->id)->whereDate('recurring_due_date','>',$row->recurring_due_date)->exists()){
                        $source->update(['last_purchased_at'=>$row->previous_purchased_on?->toDateString(),'due_date'=>$row->recurring_due_date->toDateString(),'purchase_revision'=>(int)$source->purchase_revision+1]);
                    }
                }
                if(!$completed){$data['schedule_revision']=null;}
            }
            $row->update($data);
            return $row->fresh();
        });
    }

    public function purchased(PlannedPurchase $purchase, string $date, string $userId): PlannedPurchase
    {
        return DB::transaction(function()use($purchase,$date,$userId){
            $source=PlannedPurchase::whereKey($purchase->id)->lockForUpdate()->firstOrFail();
            abort_unless($source->type==='RECURRING' && $source->status==='ACTIVE' && $source->cadence_months,422,'Регулярная покупка больше не доступна.');
            $next=Carbon::parse($date)->addMonthsNoOverflow((int)$source->cadence_months)->toDateString();
            $source->update(['last_purchased_at'=>$date,'due_date'=>$next,'purchase_revision'=>(int)$source->purchase_revision+1]);
            StoreListItem::where('recurring_purchase_id',$source->id)->where('is_completed',false)
                ->whereDate('recurring_due_date','<=',$date)->update(['is_completed'=>true,'completed_at'=>now(),'completed_by'=>$userId,'updated_at'=>now()]);
            return $source->fresh()->load('creator');
        });
    }
}
