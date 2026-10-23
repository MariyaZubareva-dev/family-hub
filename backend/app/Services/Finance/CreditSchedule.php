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
        $candidates=$this->regularSchedule($credit,$today);$next=null;
        foreach($candidates as $row)if($row['date']>=$today&&$row['status']!=='PAID'){$next=['date'=>$row['date'],'amount'=>$row['remaining_amount'],'planned_amount'=>$row['payment'],'paid_amount'=>$row['paid_amount']];break;}
        return ['last_payment_date'=>$end,'last_paid_on'=>$paidDates->max(),'next_payment'=>$next,'bank_schedule_stale'=>(bool)($graph['stale']??false),'schedule_source'=>$graph?'BANK':'CONTRACT',
            'estimated_last_payment_date'=>$projection['last_payment_date']??null,'estimated_next_payment'=>collect($projection['rows']??[])->first(fn($r)=>$r['date']>=$today),
            'projection_error'=>$projectionError,'projection_available'=>$projection!==null,'regular_schedule'=>$candidates,
            'payment_history'=>$credit->payments->map(fn($p)=>[...$p->toArray(),'included_in_bank_snapshot'=>$this->includedInSnapshot($credit,$p),'display_scheduled_on'=>$this->includedInSnapshot($credit,$p)?$p->paid_on->toDateString():$p->scheduled_on->toDateString()])->values()->all(),
            'bank_balance_as_of'=>$graph['as_of']??null,'bank_opening_balance'=>$graph['opening_balance']??null];
    }
    public function includedInSnapshot(Credit $credit,$payment): bool
    {
        $graph=$credit->bank_schedule;
        if(!$graph||$payment->paid_on->toDateString()>$graph['as_of'])return false;
        if(array_key_exists('included_payment_ids',$graph))return in_array($payment->id,$graph['included_payment_ids'],true);
        // Older imports did not retain the journal IDs. Only records existing before the snapshot qualify.
        return !empty($graph['saved_at'])&&$payment->created_at&&$payment->created_at->lt(CarbonImmutable::parse($graph['saved_at']));
    }
    public function regularSchedule(Credit $credit,string $today): array
    {
        $first=CarbonImmutable::parse($credit->first_payment_date)->startOfDay();$candidates=$credit->bank_schedule['rows']??[];$source=$candidates?'BANK':'CONTRACT';
        if(!$candidates)for($i=0;$i<$credit->term_months;$i++){
            $payment=(float)$credit->standard_payment;
            foreach($credit->payment_schedule??[] as $segment)if($i+1>=$segment['from_month']&&$i+1<=$segment['to_month']){$payment=(float)$segment['amount'];break;}
            $candidates[]=['date'=>$first->addMonthsNoOverflow($i)->toDateString(),'payment'=>$payment];
        }
        $dates=array_column($candidates,'date');$grouped=$credit->payments->groupBy(fn($p)=>$this->includedInSnapshot($credit,$p)?$p->paid_on->toDateString():$p->scheduled_on->toDateString());
        foreach($grouped as $date=>$payments)if(!in_array($date,$dates,true))$candidates[]=['date'=>$date,'payment'=>round((float)$payments->sum('amount'),2),'source'=>'JOURNAL'];
        $result=[];
        foreach($candidates as $row){
            $payments=$grouped->get($row['date'],collect());$paid=$this->cents($payments->sum('amount'));$planned=$this->cents($row['payment']);
            $result[]=[...$row,'source'=>$row['source']??$source,'paid_amount'=>$paid/100,'remaining_amount'=>max(0,$planned-$paid)/100,
                'status'=>$paid>=$planned?'PAID':($paid>0?'PARTIAL':($row['date']<$today?'OVERDUE':'UPCOMING')),
                'paid_on'=>$payments->max('paid_on')?->toDateString(),'payment_ids'=>$payments->pluck('id')->values()->all()];
        }
        usort($result,fn($a,$b)=>strcmp($a['date'],$b['date']));return $result;
    }
    /** Replay new prepayments against the original bank intervals, without changing the bank graph. */
    public function projection(Credit $credit,?array $scenario=null): array
    {
        $graph=$credit->bank_schedule;
        abort_unless($graph && ($graph['complete']??false),422,'Для пересчёта даты окончания нужен полный график банка.');
        abort_if(($graph['stale']??false)&&($graph['stale_reason']??'CONTRACT')==='CONTRACT',422,'Условия кредита изменились. Загрузите новый график банка.');
        $basis=$this->prepaymentBasis($credit,$graph['as_of']);
        abort_if($basis!==($graph['prepayment_basis']??[]),422,'Изменён платёж, уже учтённый в исходном остатке. Обновите график банка.');
        $events=$credit->prepayments->filter(fn($p)=>$p->paid_on->toDateString()>$graph['as_of'])->sortBy(fn($p)=>$p->paid_on->toDateString().$p->id)->values();
        if($scenario){$event=new \App\Models\CreditPrepayment([...$scenario,'id'=>'zz_scenario']);$events=$events->push($event)->sortBy(fn($p)=>$p->paid_on->toDateString().$p->id)->values();}
        $future=[];$opening=$this->cents($graph['opening_balance']);$previous=$graph['as_of'];
        foreach($graph['rows'] as $row){$future[]=[...$row,'opening'=>$opening,'previous_date'=>$previous];$opening=$this->cents($row['balance']);$previous=$row['date'];}
        $balance=$this->cents($graph['opening_balance']);$accrued=0.0;$scale=1.0;$cursor=$graph['as_of'];$result=[];$index=0;$lastDate=$graph['as_of'];$applied=[];
        foreach($future as $i=>$row){
            $days=(float)CarbonImmutable::parse($row['previous_date'])->diffInDays(CarbonImmutable::parse($row['date']));
            $rate=$row['opening']>0?$this->cents($row['interest'])/$row['opening']/$days:0;
            while(isset($events[$index])&&$events[$index]->paid_on->toDateString()<$row['date']){
                $event=$events[$index++];$date=$event->paid_on->toDateString();
                $accrued+=$balance*$rate*(float)CarbonImmutable::parse($cursor)->diffInDays(CarbonImmutable::parse($date));$cursor=$date;
                $applied[$event->id]=$this->applyEvent($event,$credit,$future,$i,$date,$balance,$accrued,$scale);$lastDate=$date;
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
                $event=$events[$index++];$applied[$event->id]=$this->applyEvent($event,$credit,$future,$i+1,$row['date'],$balance,$accrued,$scale);
            }
        }
        abort_if($index<count($events),422,'Досрочный платёж указан после расчётного погашения. Сверьте даты с банком.');
        abort_if($balance>2||round($accrued)>2,422,'Не удалось завершить расчёт. Загрузите обновлённый график банка.');
        return ['rows'=>$result,'last_payment_date'=>$lastDate,'as_of'=>$graph['as_of'],'opening_balance'=>$graph['opening_balance'],'applied_prepayments'=>$applied];
    }
    private function applyEvent($event,Credit $credit,array $future,int $i,string $date,int &$balance,float &$accrued,float &$scale): array
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
        return ['paid_on'=>$date,'amount'=>$amount/100,'principal'=>$principal/100,'interest'=>$interest/100];
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
        abort_unless($graph && !empty($graph['rows']),422,'Сначала добавьте график банка.');
        $date=$data['paid_on'];
        abort_unless($date>=max($today,$graph['as_of']),422,'Дата расчёта не может быть раньше сегодняшнего дня и даты исходного остатка.');
        $before=$this->projection($credit);
        abort_unless($date<$before['last_payment_date'],422,'Выберите дату до расчётного окончания кредита.');
        $after=$this->projection($credit,$data);
        $original=array_values(array_filter($before['rows'],fn($row)=>$row['date']>$date));
        $rows=array_values(array_filter($after['rows'],fn($row)=>$row['date']>$date));
        $interestBefore=array_sum(array_column($before['rows'],'interest'))+array_sum(array_column($before['applied_prepayments'],'interest'));
        $interestAfter=array_sum(array_column($after['rows'],'interest'))+array_sum(array_column($after['applied_prepayments'],'interest'));
        return ['kind'=>'ESTIMATE','basis'=>'BANK_SCHEDULE','interest_policy'=>$data['interest_policy'],'recalculation_mode'=>$data['recalculation_mode'],
            'prepayment'=>$after['applied_prepayments']['zz_scenario'],'next_payment'=>$rows[0]??null,'last_payment_date'=>$after['last_payment_date'],
            'original_last_payment_date'=>$before['last_payment_date'],'payments_removed'=>count($original)-count($rows),'interest_saved'=>round($interestBefore-$interestAfter,2),'rows'=>$rows,
            'assumptions'=>['Расчёт основан на графике банка и сохранённых досрочных платежах. Журнал регулярных оплат не меняет суммы и проценты банковского графика.','Плановые платежи считаются внесёнными по графику; в день досрочного погашения сначала проходит плановый платёж.','Проценты распределяются по дням каждого банковского интервала. Фактическое округление и изменение условий определяет банк.']];
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
