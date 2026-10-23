<?php
namespace App\Services\Finance;
use App\Models\Credit;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

class CreditSchedule
{
    private function cents(mixed $value): int {return (int)round((float)$value*100);}
    public function invalidate(Credit $credit,string $reason='CONTRACT'): void
    {
        DB::transaction(function()use($credit,$reason){
            $locked=Credit::whereKey($credit->id)->lockForUpdate()->firstOrFail();$graph=$locked->bank_schedule;
            if(!$graph)return;
            if(($graph['stale']??false)&&($graph['stale_reason']??'CONTRACT')==='CONTRACT')$reason='CONTRACT';
            $locked->update(['bank_schedule'=>[...$graph,'stale'=>true,'stale_reason'=>$reason]]);
        });
    }
    public function prepaymentBasis(Credit $credit,string $asOf): array
    {
        return $credit->prepayments->filter(fn($p)=>$p->paid_on->toDateString()<=$asOf)->sortBy('id')->map(fn($p)=>[
            'id'=>$p->id,'date'=>$p->paid_on->toDateString(),'amount'=>$this->cents($p->amount),'mode'=>$p->recalculation_mode?:$credit->recalculation_mode,'policy'=>$p->interest_policy,
        ])->values()->all();
    }
    public function summary(Credit $credit,string $today): array
    {
        $graph=$credit->bank_schedule;$rows=$graph['rows']??[];$projection=null;$projectionError=null;
        if($graph && ($graph['stale']??false)){
            try{$projection=$this->projection($credit);}
            catch(\Symfony\Component\HttpKernel\Exception\HttpException $e){$projectionError=$e->getMessage();}
        }
        $first=CarbonImmutable::parse($credit->first_payment_date)->startOfDay();
        $end=$rows?end($rows)['date']:$first->addMonthsNoOverflow(max(0,$credit->term_months-1))->toDateString();
        $paidDates=$credit->payments->pluck('paid_on')->merge($credit->prepayments->pluck('paid_on'))->map(fn($date)=>CarbonImmutable::parse($date)->toDateString());
        $candidates=$rows;
        if(!$candidates)for($i=0;$i<$credit->term_months;$i++){
            $payment=(float)$credit->standard_payment;
            foreach($credit->payment_schedule??[] as $segment)if($i+1>=$segment['from_month']&&$i+1<=$segment['to_month']){$payment=(float)$segment['amount'];break;}
            $candidates[]=['date'=>$first->addMonthsNoOverflow($i)->toDateString(),'payment'=>$payment];
        }
        $next=null;
        foreach($candidates as $row){
            $paid=$credit->payments->filter(fn($payment)=>$payment->scheduled_on->toDateString()===$row['date'])->sum('amount');
            if($row['date']>=$today && $this->cents($paid)<$this->cents($row['payment'])){$next=['date'=>$row['date'],'amount'=>max(0,$row['payment']-(float)$paid),'planned_amount'=>(float)$row['payment'],'paid_amount'=>(float)$paid];break;}
        }
        return ['last_payment_date'=>$end,'last_paid_on'=>$paidDates->max(),'next_payment'=>$next,'bank_schedule_stale'=>(bool)($graph['stale']??false),'schedule_source'=>$graph?'BANK':'CONTRACT',
            'estimated_last_payment_date'=>$projection['last_payment_date']??null,'estimated_next_payment'=>collect($projection['rows']??[])->first(fn($r)=>$r['date']>=$today),
            'projection_error'=>$projectionError,'projection_available'=>$projection!==null];
    }
    /** Replay new prepayments against the original bank intervals, without changing the bank graph. */
    public function projection(Credit $credit): array
    {
        $graph=$credit->bank_schedule;
        abort_unless($graph && ($graph['complete']??false),422,'Для пересчёта даты окончания нужен полный график банка.');
        abort_if(($graph['stale']??false)&&($graph['stale_reason']??'CONTRACT')==='CONTRACT',422,'Условия кредита изменились. Загрузите новый график банка.');
        $basis=$this->prepaymentBasis($credit,$graph['as_of']);
        abort_if($basis!==($graph['prepayment_basis']??[]),422,'Изменён платёж, уже учтённый в исходном остатке. Обновите график банка.');
        $events=$credit->prepayments->filter(fn($p)=>$p->paid_on->toDateString()>$graph['as_of'])->sortBy(fn($p)=>$p->paid_on->toDateString().$p->id)->values();
        // Dated payments must agree with the bank graph before using it as a calculation basis.
        foreach($credit->payments->groupBy(fn($p)=>$p->scheduled_on->toDateString()) as $date=>$payments){
            if($date<=$graph['as_of'])continue;
            $planned=collect($graph['rows'])->firstWhere('date',$date);
            abort_if(!$planned||abs($this->cents($payments->sum('amount'))-$this->cents($planned['payment']))>2||$payments->contains(fn($p)=>$p->paid_on->toDateString()!==$date),422,'Оплаты отличаются от графика банка. Сверьте даты и суммы перед пересчётом срока.');
        }
        $future=[];$opening=$this->cents($graph['opening_balance']);$previous=$graph['as_of'];
        foreach($graph['rows'] as $row){$future[]=[...$row,'opening'=>$opening,'previous_date'=>$previous];$opening=$this->cents($row['balance']);$previous=$row['date'];}
        $balance=$this->cents($graph['opening_balance']);$accrued=0.0;$scale=1.0;$cursor=$graph['as_of'];$result=[];$index=0;$lastDate=$graph['as_of'];
        foreach($future as $i=>$row){
            $days=(float)CarbonImmutable::parse($row['previous_date'])->diffInDays(CarbonImmutable::parse($row['date']));
            $rate=$row['opening']>0?$this->cents($row['interest'])/$row['opening']/$days:0;
            while(isset($events[$index])&&$events[$index]->paid_on->toDateString()<$row['date']){
                $event=$events[$index++];$date=$event->paid_on->toDateString();
                $accrued+=$balance*$rate*(float)CarbonImmutable::parse($cursor)->diffInDays(CarbonImmutable::parse($date));$cursor=$date;
                $this->applyEvent($event,$credit,$future,$i,$date,$balance,$accrued,$scale);$lastDate=$date;
            }
            if($balance<=0&&round($accrued)<=0)break;
            $accrued+=$balance*$rate*(float)CarbonImmutable::parse($cursor)->diffInDays(CarbonImmutable::parse($row['date']));$cursor=$row['date'];
            $interest=(int)round($accrued);$accrued=0.0;$fees=$this->cents($row['fees']);
            $payment=min((int)round(($this->cents($row['payment'])-$fees)*$scale)+$fees,$balance+$interest+$fees);
            abort_if($payment<$interest+$fees,422,'Платёж не покрывает проценты и услуги. Нужен обновлённый график банка.');
            $principal=$payment-$interest-$fees;$balance-=$principal;$lastDate=$row['date'];
            $result[]=['date'=>$row['date'],'payment'=>$payment/100,'principal'=>$principal/100,'interest'=>$interest/100,'fees'=>$fees/100,'balance'=>$balance/100];
            // On a bank payment date the scheduled payment is applied before the prepayment.
            while(isset($events[$index])&&$events[$index]->paid_on->toDateString()===$row['date']){
                $event=$events[$index++];$this->applyEvent($event,$credit,$future,$i+1,$row['date'],$balance,$accrued,$scale);
            }
        }
        abort_if($index<count($events),422,'Досрочный платёж указан после расчётного погашения. Сверьте даты с банком.');
        abort_if($balance>2||round($accrued)>2,422,'Не удалось завершить расчёт. Загрузите обновлённый график банка.');
        return ['rows'=>$result,'last_payment_date'=>$lastDate,'as_of'=>$graph['as_of'],'opening_balance'=>$graph['opening_balance']];
    }
    private function applyEvent($event,Credit $credit,array $future,int $i,string $date,int &$balance,float &$accrued,float &$scale): void
    {
        $policy=$event->interest_policy;
        abort_if(!$policy&&array_sum(array_column($future,'interest'))>0,422,'Укажите порядок списания процентов у досрочного платежа от '.CarbonImmutable::parse($date)->format('d.m.Y').'.');
        $amount=$this->cents($event->amount);$interest=$policy==='FROM_PREPAYMENT'?min($amount,(int)round($accrued)):0;
        $principal=$amount-$interest;
        abort_if($principal<=0||$principal>$balance,422,'Досрочная сумма не соответствует основному долгу. Сверьте платёж с банком.');
        $balance-=$principal;$accrued-=$interest;
        if(($event->recalculation_mode?:$credit->recalculation_mode)==='PAYMENT'&&$balance>0){
            $remaining=array_slice($future,$i);abort_unless($remaining,422,'После досрочного платежа нет будущих строк графика.');
            $prior=$this->simulate($remaining,$date,$balance+$principal,(int)round($accrued)+$interest,$scale,true);
            $remaining=array_slice($remaining,0,count($prior['rows']));$low=0.0;$high=$scale;
            for($j=0;$j<65;$j++){$mid=($low+$high)/2;$trial=$this->simulate($remaining,$date,$balance,(int)round($accrued),$mid,false);if($trial['remaining']>0)$low=$mid;else$high=$mid;}
            $scale=$high;
        }
    }
    public function validateGraph(array $data): array
    {
        $balance=$this->cents($data['opening_balance']);$previous=$data['as_of'];
        foreach($data['rows'] as $i=>&$row){
            abort_unless($row['date']>$previous,422,'Даты графика должны идти по возрастанию и быть позже даты остатка.');
            foreach(['payment','principal','interest','fees','balance'] as $field)$row[$field]=round((float)($row[$field]??0),2);
            abort_if(abs($this->cents($row['payment'])-$this->cents($row['principal'])-$this->cents($row['interest'])-$this->cents($row['fees']))>2,422,'В строке '.($i+1).' платёж не совпадает с суммой основного долга, процентов и услуг.');
            abort_if(abs($balance-$this->cents($row['principal'])-$this->cents($row['balance']))>2,422,'В строке '.($i+1).' не сходится остаток основного долга. Проверьте исходный остаток и погашение долга.');
            $balance=$this->cents($row['balance']);$previous=$row['date'];
        }
        return [...$data,'complete'=>$balance<=2,'stale'=>false,'saved_at'=>now()->toISOString()];
    }
    public function forecast(Credit $credit,array $data,string $today): array
    {
        $graph=$credit->bank_schedule;
        abort_unless($graph && !empty($graph['rows']),422,'Сначала добавьте актуальный график банка.');
        abort_if($graph['stale']??false,422,'После изменения платежей загрузите обновлённый график банка.');
        abort_unless($graph['complete']??false,422,'Для расчёта нужен полный график до нулевого остатка.');
        $date=$data['paid_on'];
        abort_unless($date>=max($today,$graph['as_of']),422,'Дата расчёта не может быть раньше сегодняшнего дня и даты исходного остатка.');
        $previous=$graph['as_of'];$balance=$this->cents($graph['opening_balance']);$future=[];
        foreach($graph['rows'] as $row){
            $item=[...$row,'previous_date'=>$previous,'opening'=>$balance];
            if($row['date']>$date)$future[]=$item;
            $previous=$row['date'];$balance=$this->cents($row['balance']);
        }
        abort_unless($future,422,'Выберите дату до последнего платежа банковского графика.');
        // A same-day regular payment is assumed to have been made before the early repayment.
        $first=$future[0];$balance=$first['opening'];
        foreach($credit->payments as $payment){
            if($payment->scheduled_on->toDateString()<=$graph['as_of'])continue;
            $planned=collect($graph['rows'])->firstWhere('date',$payment->scheduled_on->toDateString());
            abort_if(!$planned || ($payment->paid_on->toDateString()<=$date && $payment->scheduled_on->toDateString()>$date),422,'Оплата вне дат банковского графика. Сначала сохраните обновлённый график с учётом этой оплаты.');
            if($payment->scheduled_on->toDateString()>$date)continue;
            if($planned){$paid=$credit->payments->filter(fn($p)=>$p->scheduled_on->toDateString()===$payment->scheduled_on->toDateString())->sum('amount');abort_if(abs($this->cents($paid)-$this->cents($planned['payment']))>2,422,'Фактический платёж отличается от графика. Уточните его или обновите график банка.');}
        }
        $days=(float)CarbonImmutable::parse($first['previous_date'])->diffInDays(CarbonImmutable::parse($first['date']));
        $elapsed=(float)CarbonImmutable::parse($first['previous_date'])->diffInDays(CarbonImmutable::parse($date));
        $accrued=(int)round($this->cents($first['interest'])*$elapsed/$days);
        $amount=$this->cents($data['amount']);$interestPaid=$data['interest_policy']==='FROM_PREPAYMENT'?min($amount,$accrued):0;
        $principal=$amount-$interestPaid;
        abort_if($principal<=0,422,'Эта сумма покрывает только начисленные проценты и не уменьшает основной долг.');
        abort_if($principal>$balance,422,'Сумма досрочного платежа превышает остаток основного долга с учётом выбранного порядка процентов.');
        $balance-=$principal;$carry=$accrued-$interestPaid;
        $scale=1.0;
        if($data['recalculation_mode']==='PAYMENT'){
            $low=0.0;$high=1.0;
            for($i=0;$i<65;$i++){$mid=($low+$high)/2;$result=$this->simulate($future,$date,$balance,$carry,$mid,false);if($result['remaining']>0)$low=$mid;else$high=$mid;}
            $scale=$high;
        }
        $result=$this->simulate($future,$date,$balance,$carry,$scale,true);
        abort_if($result['remaining']>2,422,'По этому графику расчёт не завершает погашение. Проверьте суммы и услуги банка.');
        $originalInterest=array_sum(array_map(fn($row)=>$this->cents($row['interest']),$future));
        $newInterest=$interestPaid+array_sum(array_map(fn($row)=>$this->cents($row['interest']),$result['rows']));
        return ['kind'=>'ESTIMATE','basis'=>'BANK_SCHEDULE','interest_policy'=>$data['interest_policy'],'recalculation_mode'=>$data['recalculation_mode'],'prepayment'=>['paid_on'=>$date,'amount'=>$amount/100,'principal'=>$principal/100,'interest'=>$interestPaid/100],
            'next_payment'=>$result['rows'][0]??null,'last_payment_date'=>$result['rows']?end($result['rows'])['date']:$date,'original_last_payment_date'=>end($future)['date'],'payments_removed'=>count($future)-count($result['rows']),'interest_saved'=>round(($originalInterest-$newInterest)/100,2),'rows'=>$result['rows'],
            'assumptions'=>['Плановые платежи до выбранной даты внесены по графику; в день досрочного погашения сначала проходит плановый платёж.','Проценты выводятся отдельно из каждого интервала банковского графика; внутри интервала распределяются пропорционально дням. Услуги сохраняются по исходному графику.','Фактические правила округления, списания процентов и изменения условий определяет банк. После досрочного платежа сохраните новый график банка.']];
    }
    private function simulate(array $future,string $date,int $balance,int $carry,float $scale,bool $clip): array
    {
        $result=[];
        foreach($future as $i=>$row){
            if($balance<=0 && $carry<=0)break;
            $fraction=$i===0?(float)CarbonImmutable::parse($date)->diffInDays(CarbonImmutable::parse($row['date']))/(float)CarbonImmutable::parse($row['previous_date'])->diffInDays(CarbonImmutable::parse($row['date'])):1.0;
            $interest=$carry+($row['opening']>0?(int)round($balance*$this->cents($row['interest'])/$row['opening']*$fraction):0);$carry=0;
            $fees=$this->cents($row['fees']);$payment=(int)round(($this->cents($row['payment'])-$fees)*$scale)+$fees;
            if($clip){abort_if($payment<$interest+$fees,422,'Платёж не покрывает проценты и услуги. Для такого графика нужен уточнённый расчёт банка.');$payment=min($payment,$balance+$interest+$fees);}
            $principal=$payment-$interest-$fees;$balance-=$principal;
            $result[]=['date'=>$row['date'],'payment'=>$payment/100,'principal'=>$principal/100,'interest'=>$interest/100,'fees'=>$fees/100,'balance'=>max(0,$balance)/100];
            if($balance<=0)break;
        }
        return ['remaining'=>$balance,'rows'=>$result];
    }
}
