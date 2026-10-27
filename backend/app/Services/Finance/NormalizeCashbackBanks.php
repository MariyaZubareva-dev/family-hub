<?php
namespace App\Services\Finance;
use App\Models\CashbackBankPeriod;
use Illuminate\Support\Facades\DB;

class NormalizeCashbackBanks
{
    public function run(bool $apply=false): array
    {
        return DB::transaction(function()use($apply){
            if($apply && DB::getDriverName()==='pgsql')DB::statement('LOCK TABLE cashback_bank_periods IN SHARE ROW EXCLUSIVE MODE');
            $query=CashbackBankPeriod::withTrashed()->orderBy('updated_at')->orderBy('id');
            if($apply)$query->lockForUpdate();
            $groups=$query->get()->groupBy(fn($row)=>implode('|',[$row->family_id,$row->created_by,$row->month,CashbackBankCatalog::key($row->bank_name)]));
            $stats=['renamed'=>0,'merged'=>0,'unknown'=>[]];
            foreach($groups as $group){
                $latest=$group->last();$canonical=CashbackBankCatalog::find($latest->bank_name);
                if(!$canonical){$stats['unknown'][]=$latest->bank_name;continue;}
                $key=CashbackBankCatalog::key($canonical['name']);
                $changed=$group->count()>1 || $group->contains(fn($row)=>$row->bank_name!==$canonical['name'] || $row->bank_key!==$key);
                if(!$changed)continue;
                $stats['renamed']+=$group->filter(fn($row)=>$row->bank_name!==$canonical['name'] || $row->bank_key!==$key)->count();
                $stats['merged']+=$group->count()-1;
                if(!$apply)continue;
                foreach($group as $row)DB::table('cashback_bank_normalization_backups')->insertOrIgnore(['original_id'=>$row->id,'family_id'=>$row->family_id,'created_by'=>$row->created_by,'payload'=>json_encode($row->getAttributes(),JSON_UNESCAPED_UNICODE),'normalized_at'=>now()]);
                // Never resurrect a deleted record; deleted categories are not merged into active ones.
                $live=$group->filter(fn($row)=>!$row->trashed());$keeper=$live->last()??$latest;$entries=[];
                foreach($live->isNotEmpty()?$live:$group as $row)foreach($row->entries as $entry){
                    $category=mb_strtolower(str_replace('ё','е',trim(preg_replace('/\s+/u',' ',$entry['category']))));
                    $entries[$category]=$entry; // Most recently edited record wins conflicting conditions.
                }
                foreach($group as $row)if($row->id!==$keeper->id)$row->forceDelete();
                $keeper->update(['bank_name'=>$canonical['name'],'bank_key'=>$key,'entries'=>array_values($entries),'revision'=>$group->max('revision')+1]);
            }
            $stats['unknown']=array_values(array_unique($stats['unknown']));return $stats;
        });
    }
}
