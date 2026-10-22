<?php
namespace App\Services\Finance;
use App\Models\Credit;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

class CreditSchedule
{
    private function cents(mixed $value): int {return (int)round((float)$value*100);}
    public function invalidate(Credit $credit): void
    {
        DB::table('credits')->where('id',$credit->id)->whereNotNull('bank_schedule')->update(['bank_schedule->stale'=>true]);
    }
    public function summary(Credit $credit,string $today): array
    {
        $graph=$credit->bank_schedule;$rows=$graph['rows']??[];
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
            if($row['date']>=$today && $this->cents($paid)<$this->cents($row['payment'])){$next=['date'=>$row['date'],'amount'=>max(0,$row['payment']-(float)$paid)];break;}
        }
        return ['last_payment_date'=>$end,'last_paid_on'=>$paidDates->max(),'next_payment'=>$next,'bank_schedule_stale'=>(bool)($graph['stale']??false),'schedule_source'=>$graph?'BANK':'CONTRACT'];
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
