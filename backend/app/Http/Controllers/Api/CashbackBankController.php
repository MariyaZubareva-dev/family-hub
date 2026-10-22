<?php

namespace App\Http\Controllers\Api;

use App\Models\CashbackBankPeriod;
use App\Models\FamilyMember;
use App\Services\Finance\CashbackRecognizer;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CashbackBankController extends BaseApiController
{
    public function index(Request $request): JsonResponse
    {
        $member=$this->membership($request);
        $data=$request->validate(['month'=>['nullable','date_format:Y-m']]);
        $month=$data['month']??now($member->family->timezone?:'Europe/Moscow')->format('Y-m');
        $records=CashbackBankPeriod::with('creator:id,first_name,last_name,username')->where('family_id',$member->family_id)->where('month',$month)->orderBy('bank_name')->get();
        return response()->json(['data'=>$records->map(fn($record)=>$this->present($record,$member)), 'meta'=>['month'=>$month,'today'=>now($member->family->timezone?:'Europe/Moscow')->toDateString(),'user_id'=>$member->user_id]]);
    }

    public function store(Request $request): JsonResponse
    {
        $member=$this->membership($request);
        $data=$this->validated($request);
        $key=CashbackBankPeriod::bankKey($data['bank_name']);
        abort_if($key==='',422,'Укажите название банка.');
        try {
            [$record,$created]=DB::transaction(function () use ($member,$data,$key) {
                $record=CashbackBankPeriod::withTrashed()->where(['family_id'=>$member->family_id,'created_by'=>$member->user_id,'bank_key'=>$key,'month'=>$data['month']])->lockForUpdate()->first();
                if($record && !$record->trashed()) {
                    abort_unless(isset($data['revision']) && $data['revision']===$record->revision,409,'Категории этого банка уже изменились. Обновите список и повторите редактирование.');
                }
                $created=!$record;
                $record??=new CashbackBankPeriod(['family_id'=>$member->family_id,'created_by'=>$member->user_id,'bank_key'=>$key,'month'=>$data['month']]);
                $record->fill(['bank_name'=>$data['bank_name'],'entries'=>$data['entries'],'revision'=>$created?1:$record->revision+1,'deleted_at'=>null]);
                $record->save();
                return [$record,$created];
            });
        } catch(QueryException $e) {
            if($e->getCode()==='23505')abort(409,'Категории этого банка уже добавлены. Обновите список и откройте их для редактирования.');
            throw $e;
        }
        return response()->json(['data'=>$this->present($record,$member)],$created?201:200);
    }

    public function update(Request $request, string $cashback): JsonResponse
    {
        $member=$this->membership($request);
        $data=$this->validated($request);
        $record=DB::transaction(function () use ($member,$cashback,$data) {
            $record=$this->owned($member,$cashback);
            abort_unless(isset($data['revision']) && $data['revision']===$record->revision,409,'Категории уже изменились. Обновите список и повторите редактирование.');
            abort_unless(CashbackBankPeriod::bankKey($data['bank_name'])===$record->bank_key && $data['month']===$record->month,422,'Для другого банка или месяца создайте новую запись.');
            $record->update(['entries'=>$data['entries'],'bank_name'=>$data['bank_name'],'revision'=>$record->revision+1]);
            return $record;
        });
        return response()->json(['data'=>$this->present($record,$member)]);
    }

    public function destroy(Request $request, string $cashback): JsonResponse
    {
        $member=$this->membership($request);
        $data=$request->validate(['revision'=>['required','integer','min:1']]);
        DB::transaction(function () use ($member,$cashback,$data) {
            $record=$this->owned($member,$cashback);
            abort_unless($record->revision===$data['revision'],409,'Категории уже изменились. Обновите список перед удалением.');
            $record->increment('revision');$record->delete();
        });
        return response()->json([],204);
    }

    public function recognize(Request $request, CashbackRecognizer $recognizer): JsonResponse
    {
        $this->membership($request);
        $data=$request->validate(['image_data'=>['required','string','max:8000000']]);
        $parts=explode(',',$data['image_data'],2);
        abort_unless(count($parts)===2 && preg_match('#^data:image/(jpeg|png|webp);base64$#',$parts[0]),422,'Выберите скриншот в формате JPEG, PNG или WebP.');
        $bytes=base64_decode($parts[1],true);$size=$bytes===false?false:@getimagesizefromstring($bytes);
        abort_unless($size && in_array($size['mime']??'', ['image/png','image/jpeg','image/webp'],true) && strlen($bytes)<=5*1024*1024 && $size[0]*$size[1]<=16000000,422,'Не удалось прочитать изображение. Выберите скриншот до 5 МБ и 16 мегапикселей.');
        return response()->json(['data'=>$recognizer->recognize($data['image_data'])]);
    }

    private function owned(FamilyMember $member,string $id): CashbackBankPeriod
    {
        $record=CashbackBankPeriod::where('family_id',$member->family_id)->lockForUpdate()->findOrFail($id);
        abort_unless($record->created_by===$member->user_id || $member->role==='ADMIN',403,'Изменять эти категории может их автор или администратор семьи.');
        return $record;
    }
    private function present(CashbackBankPeriod $record,FamilyMember $member): array
    {
        return [...$record->loadMissing('creator:id,first_name,last_name,username')->toArray(),'can_edit'=>$record->created_by===$member->user_id || $member->role==='ADMIN'];
    }
    private function validated(Request $request): array
    {
        $data=$request->validate([
            'bank_name'=>['required','string','max:100'], 'month'=>['required','date_format:Y-m'], 'revision'=>['nullable','integer','min:1'],
            'entries'=>['required','array','min:1','max:60'], 'entries.*'=>['required','array:category,rate,reward_unit,active,cap_amount,notes,valid_from,valid_to'],
            'entries.*.category'=>['required','string','max:120'], 'entries.*.rate'=>['required','numeric','gt:0','max:100'],
            'entries.*.reward_unit'=>['required','in:RUB,POINTS,MILES'], 'entries.*.active'=>['required','boolean'],
            'entries.*.cap_amount'=>['nullable','numeric','min:0'], 'entries.*.notes'=>['nullable','string','max:500'],
            'entries.*.valid_from'=>['nullable','date_format:Y-m-d'], 'entries.*.valid_to'=>['nullable','date_format:Y-m-d'],
        ],['required'=>'Заполните поле :attribute.','entries.required'=>'Добавьте хотя бы одну категорию.','entries.*.rate.gt'=>'Процент должен быть больше нуля.','entries.*.rate.max'=>'Процент не может превышать 100.']);
        $data['bank_name']=trim(preg_replace('/\s+/u',' ',$data['bank_name']));
        $seen=[];
        foreach($data['entries'] as &$entry) {
            $entry['category']=trim(preg_replace('/\s+/u',' ',$entry['category']));
            abort_if($entry['category']==='',422,'Укажите название каждой категории.');
            $key=mb_strtolower(str_replace('ё','е',$entry['category']));
            abort_if(isset($seen[$key]),422,'В списке есть повторяющаяся категория. Объедините её условия в одной строке.');$seen[$key]=true;
            $entry['rate']=(float)$entry['rate'];$entry['active']=(bool)$entry['active'];
            $entry['cap_amount']=isset($entry['cap_amount'])?(float)$entry['cap_amount']:null;
            $entry['notes']=trim($entry['notes']??'')?:null;
            foreach(['valid_from','valid_to'] as $date)abort_if(!empty($entry[$date]) && substr($entry[$date],0,7)!==$data['month'],422,'Даты действия должны относиться к выбранному месяцу.');
            abort_if(!empty($entry['valid_from']) && !empty($entry['valid_to']) && $entry['valid_from']>$entry['valid_to'],422,'Окончание действия не может быть раньше начала.');
        }
        return $data;
    }
}
