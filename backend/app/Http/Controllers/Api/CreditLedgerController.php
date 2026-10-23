<?php
namespace App\Http\Controllers\Api;
use App\Models\{Credit,CreditPayment};
use App\Services\Finance\CreditSchedule;
use Illuminate\Http\{JsonResponse,Request};
use Illuminate\Support\Facades\DB;

class CreditLedgerController extends BaseApiController
{
    private function credit(Request $request,string $id,bool $write=false): Credit
    {
        $member=$this->membership($request);if($write)$this->assertAdmin($member);
        return Credit::where('family_id',$member->family_id)->findOrFail($id);
    }
    private function paymentData(Request $request,Credit $credit): array
    {
        $today=now($credit->family->timezone?:'Europe/Moscow')->toDateString();
        return $request->validate(['paid_on'=>['required','date_format:Y-m-d','after_or_equal:'.$credit->start_date->format('Y-m-d'),'before_or_equal:'.$today],
            'scheduled_on'=>['required','date_format:Y-m-d','after_or_equal:'.$credit->start_date->format('Y-m-d')],
            'amount'=>['required','numeric','gt:0'],'comment'=>['nullable','string','max:255']],
            ['required'=>'Заполните поле :attribute.','paid_on.before_or_equal'=>'Нельзя отметить будущую оплату как выполненную.','amount.gt'=>'Сумма платежа должна быть больше нуля.'],
            ['paid_on'=>'Дата оплаты','scheduled_on'=>'Дата по графику','amount'=>'Сумма']);
    }
    public function storePayment(Request $request,string $credit): JsonResponse
    {
        $loan=$this->credit($request,$credit,true);$data=$this->paymentData($request,$loan);
        $payment=$loan->payments()->create([...$data,'created_by'=>$request->user()->id]);
        return response()->json(['data'=>$payment],201);
    }
    private function ownedPayment(Request $request,string $id): CreditPayment
    {
        $member=$this->membership($request);$this->assertAdmin($member);
        return CreditPayment::whereHas('credit',fn($query)=>$query->where('family_id',$member->family_id))->findOrFail($id);
    }
    public function markSchedulePayment(Request $request,string $credit,CreditSchedule $schedule): JsonResponse
    {
        $loan=$this->credit($request,$credit,true);$today=now($loan->family->timezone?:'Europe/Moscow')->toDateString();
        $data=$request->validate(['scheduled_on'=>['required','date_format:Y-m-d'],'paid'=>['required','boolean'],
            'paid_on'=>['required_if:paid,true','nullable','date_format:Y-m-d','after_or_equal:'.$loan->start_date->format('Y-m-d'),'before_or_equal:'.$today],
            'base_version'=>['required','integer','min:0']]);
        DB::transaction(function()use($loan,$data,$schedule,$today,$request){
            $locked=Credit::whereKey($loan->id)->lockForUpdate()->firstOrFail();
            abort_unless((int)($locked->bank_schedule['version']??0)===(int)$data['base_version'],409,'График изменился. Обновите кредит и отметьте оплату ещё раз.');
            $row=collect($schedule->regularSchedule($locked,$today))->firstWhere('date',$data['scheduled_on']);
            if(!$data['paid']){$locked->payments()->whereDate('scheduled_on',$data['scheduled_on'])->delete();return;}
            abort_unless($row,422,'Такой даты нет в графике. Для другой даты используйте ручную запись оплаты.');
            if($row['remaining_amount']>0)$locked->payments()->create(['scheduled_on'=>$row['date'],'paid_on'=>$data['paid_on'],'amount'=>$row['remaining_amount'],'created_by'=>$request->user()->id]);
        });
        return response()->json(['data'=>$schedule->summary($loan->fresh(),$today)]);
    }
    public function updatePayment(Request $request,string $payment): JsonResponse
    {
        $row=$this->ownedPayment($request,$payment);$row->update($this->paymentData($request,$row->credit));
        return response()->json(['data'=>$row->fresh()]);
    }
    public function destroyPayment(Request $request,string $payment): JsonResponse
    {
        $this->ownedPayment($request,$payment)->delete();return response()->json([],204);
    }
    public function bankSchedule(Request $request,string $credit,CreditSchedule $schedule): JsonResponse
    {
        $loan=$this->credit($request,$credit,true);$today=now($loan->family->timezone?:'Europe/Moscow')->toDateString();
        $data=$request->validate([
            'as_of'=>['required','date_format:Y-m-d','after_or_equal:'.$loan->start_date->format('Y-m-d'),'before_or_equal:'.$today],
            'opening_balance'=>['required','numeric','gt:0'],'base_version'=>['required','integer','min:0'],
            'rows'=>['required','array','min:1','max:600'],'rows.*'=>['required','array:date,payment,principal,interest,fees,balance'],
            'rows.*.date'=>['required','date_format:Y-m-d'],'rows.*.payment'=>['required','numeric','gt:0'],
            'rows.*.principal'=>['required','numeric','min:0'],'rows.*.interest'=>['required','numeric','min:0'],
            'rows.*.fees'=>['nullable','numeric','min:0'],'rows.*.balance'=>['required','numeric','min:0'],
        ]);
        $validated=$schedule->validateGraph($data);
        $loan=DB::transaction(function()use($loan,$validated,$schedule){
            $locked=Credit::whereKey($loan->id)->lockForUpdate()->firstOrFail();
            abort_unless((int)$validated['base_version']===(int)($locked->bank_schedule['version']??0),409,'График уже изменился. Обновите кредит перед сохранением.');
            $latest=$locked->prepayments()->max('paid_on');
            abort_if($latest && $validated['as_of']<$latest,422,'Остаток и график должны учитывать последний досрочный платёж. Выберите дату остатка не раньше него.');
            $graph=$validated;unset($graph['base_version']);$graph['version']=(int)($locked->bank_schedule['version']??0)+1;
            $graph['prepayment_basis']=$schedule->prepaymentBasis($locked,$graph['as_of']);
            $locked->update(['bank_schedule'=>$graph]);return $locked;
        });
        return response()->json(['data'=>$loan->bank_schedule]);
    }
    public function forecast(Request $request,string $credit,CreditSchedule $schedule): JsonResponse
    {
        $loan=$this->credit($request,$credit);$loan->load('payments');
        $data=$request->validate(['paid_on'=>['required','date_format:Y-m-d'],'amount'=>['required','numeric','gt:0'],
            'recalculation_mode'=>['required','in:TERM,PAYMENT'],'interest_policy'=>['required','in:NEXT_PAYMENT,FROM_PREPAYMENT']]);
        return response()->json(['data'=>$schedule->forecast($loan,$data,now($loan->family->timezone?:'Europe/Moscow')->toDateString())]);
    }
    public function importPdf(Request $request,string $credit,\App\Services\Finance\CreditPdfImporter $importer): JsonResponse
    {
        $loan=$this->credit($request,$credit,true);
        $data=$request->validate(['pdf_data'=>['required','string','max:11200000']]);
        $parts=explode(',',$data['pdf_data'],2);
        abort_unless(count($parts)===2 && $parts[0]==='data:application/pdf;base64',422,'Выберите PDF-файл.');
        $bytes=base64_decode($parts[1],true);
        abort_unless($bytes!==false && strlen($bytes)<=8*1024*1024,422,'Выберите PDF размером до 8 МБ.');
        return response()->json(['data'=>[...$importer->import($bytes),'today'=>now($loan->family->timezone?:'Europe/Moscow')->toDateString()]]);
    }
}
