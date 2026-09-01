from pathlib import Path
import re
p=Path('/mnt/data/work/frontend/src/App.tsx')
s=p.read_text()

s=s.replace(
"type CreditForm={name:string;principal:string;annual_rate:string;standard_payment:string;term_months:string;start_date:string;first_payment_date:string;recalculation_mode:'TERM'|'PAYMENT'};\ntype ScheduleRow={month:number;dueDate:string;payment:number;interest:number;principal:number;prepayment:number;prepaymentInterest:number;prepaymentPrincipal:number;totalPaid:number;balance:number;newPayment?:number;paymentChangeDate?:string;newEndDate?:string;prepaymentDates?:string[]};",
"type PaymentScheduleItem={from_month:number;to_month:number;amount:string};\ntype CreditForm={name:string;principal:string;annual_rate:string;standard_payment:string;term_months:string;start_date:string;first_payment_date:string;recalculation_mode:'TERM'|'PAYMENT';payment_schedule:PaymentScheduleItem[]};\ntype ScheduleRow={month:number;dueDate:string;payment:number;interest:number;principal:number;prepayment:number;prepaymentInterest:number;prepaymentPrincipal:number;totalPaid:number;balance:number;newPayment?:number;paymentChangeDate?:string;newEndDate?:string;prepaymentDates?:string[];status:'PAID'|'FUTURE';};")

s=s.replace(
"const emptyCredit=():CreditForm=>({name:'Ипотека',principal:'',annual_rate:'',standard_payment:'',term_months:'360',start_date:todayString(),first_payment_date:addMonths(todayString(),1,new Date().getDate()),recalculation_mode:'TERM'});",
"const emptyCredit=():CreditForm=>({name:'Ипотека',principal:'',annual_rate:'',standard_payment:'',term_months:'360',start_date:todayString(),first_payment_date:addMonths(todayString(),1,new Date().getDate()),recalculation_mode:'TERM',payment_schedule:[{from_month:1,to_month:360,amount:''}]});")

# Replace CreditsPlanner through normalizeDateOnly
start=s.index('function CreditsPlanner(')
end=s.index('function normalizeDateOnly(')
new_section=r'''function scheduleForForm(form:CreditForm):PaymentScheduleItem[]{
 const term=Math.max(1,Math.round(num(form.term_months)));
 return form.payment_schedule.map(x=>({from_month:Math.max(1,Math.round(x.from_month)),to_month:Math.max(1,Math.round(x.to_month)),amount:x.amount}));
}

function validatePaymentSchedule(items:PaymentScheduleItem[],term:number):string|null{
 const sorted=[...items].sort((a,b)=>a.from_month-b.from_month);
 if(!sorted.length)return 'Добавьте хотя бы один период договорного графика.';
 let expected=1;
 for(let i=0;i<sorted.length;i++){
  const row=sorted[i];
  if(row.from_month!==expected)return `В договорном графике есть пропуск или перекрытие перед периодом ${row.from_month}. Ожидался месяц ${expected}.`;
  if(row.to_month<row.from_month)return `Период ${row.from_month}–${row.to_month} задан неверно.`;
  if(row.to_month>term)return `Период заканчивается на ${row.to_month}-м месяце, а срок кредита — ${term} мес.`;
  if(num(row.amount)<=0)return `Укажите платёж для периода ${row.from_month}–${row.to_month}.`;
  expected=row.to_month+1;
 }
 if(expected!==term+1)return `Договорный график должен быть заполнен до ${term}-го месяца. Сейчас заканчивается на ${expected-1}-м.`;
 return null;
}

function apiSchedule(items:PaymentScheduleItem[]):Array<{from_month:number;to_month:number;amount:number}>{
 return [...items].sort((a,b)=>a.from_month-b.from_month).map(x=>({from_month:Math.round(x.from_month),to_month:Math.round(x.to_month),amount:num(x.amount)}));
}

function PaymentScheduleEditor({items,setItems,term}:{items:PaymentScheduleItem[];setItems:(items:PaymentScheduleItem[])=>void;term:number}){
 const update=(index:number,key:keyof PaymentScheduleItem,value:string)=>{const next=[...items];next[index]={...next[index],[key]:key==='amount'?value:Math.max(1,Math.round(num(value)))};setItems(next)};
 const add=()=>{const last=items[items.length-1];const from=Math.min(term,last?last.to_month+1:1);setItems([...items,{from_month:from,to_month:term,amount:''}]);};
 const remove=(index:number)=>{if(items.length===1)return;setItems(items.filter((_,i)=>i!==index));};
 const err=validatePaymentSchedule(items,term);
 return <Card title="Договорный график платежей">
   <p className="hint">Заполните реальные суммы из договора. Можно задать разные платежи по периодам — это важно, если банк меняет размер платежа в течение срока кредита.</p>
   <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>С месяца</th><th>По месяц</th><th>Платёж, ₽</th><th></th></tr></thead><tbody>{items.map((row,i)=><tr key={`${row.from_month}-${i}`}><td><input className="mini-input" type="number" min="1" max={term} value={row.from_month} onChange={e=>update(i,'from_month',e.target.value)}/></td><td><input className="mini-input" type="number" min="1" max={term} value={row.to_month} onChange={e=>update(i,'to_month',e.target.value)}/></td><td><input className="mini-input" type="number" min="0.01" step="0.01" value={row.amount} onChange={e=>update(i,'amount',e.target.value)} placeholder="69 706,07"/></td><td><button className="tiny-action" type="button" onClick={()=>remove(i)} disabled={items.length===1}>×</button></td></tr>)}</tbody></table></div>
   {err&&<div className="warning-banner">{err}</div>}
   <button className="button secondary" type="button" onClick={add} disabled={items.length>=term}>＋ Добавить период</button>
 </Card>;
}

function CreditsPlanner({credits,onReload}:{credits:Credit[];onReload:()=>Promise<void>}){
 const [showAdd,setShowAdd]=useState(credits.length===0); const [form,setForm]=useState<CreditForm>(emptyCredit()); const [saving,setSaving]=useState(false); const [localError,setLocalError]=useState<string|null>(null);
 const term=Math.max(1,Math.round(num(form.term_months)));
 const submit=async(e:FormEvent)=>{e.preventDefault();setLocalError(null);const scheduleError=validatePaymentSchedule(form.payment_schedule,term);if(scheduleError){setLocalError(scheduleError);return;}setSaving(true);try{await post('/credits',{...form,name:form.name||'Кредит',principal:num(form.principal),annual_rate:num(form.annual_rate),standard_payment:num(form.standard_payment),term_months:term,start_date:form.start_date,first_payment_date:form.first_payment_date,recalculation_mode:form.recalculation_mode,payment_schedule:apiSchedule(form.payment_schedule)});setForm(emptyCredit());setShowAdd(false);await onReload()}catch(err){setLocalError(err instanceof Error?err.message:'Не удалось создать кредит.')}finally{setSaving(false)}};
 return <div className="stack">{localError&&<div className="error-banner">{localError}</div>}<Card title="Кредиты"><div className="credit-header"><div><strong>{credits.length?'Мои кредиты':'Добавьте первый кредит'}</strong><p className="muted">Сначала задайте параметры договора. Затем добавляйте фактические досрочные платежи — даже за прошлые даты.</p></div><button className="button primary" onClick={()=>setShowAdd(v=>!v)}>{showAdd?'Отмена':'＋ Добавить кредит'}</button></div>{showAdd&&<form onSubmit={submit} className="credit-form"><div className="form-grid"><label>Название<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ипотека"/></label><label>Сумма кредита<input type="number" min="0.01" step="0.01" value={form.principal} onChange={e=>setForm({...form,principal:e.target.value})} required/></label><label>Годовая ставка, %<input type="number" min="0" step="0.01" value={form.annual_rate} onChange={e=>setForm({...form,annual_rate:e.target.value})} required/></label><label>Ежемесячный платёж<input type="number" min="0.01" step="0.01" value={form.standard_payment} onChange={e=>setForm({...form,standard_payment:e.target.value})} required/></label><label>Срок кредита, месяцев<input type="number" min="1" max="600" step="1" value={form.term_months} onChange={e=>{const nextTerm=Math.max(1,Math.round(num(e.target.value)));const current=form.payment_schedule;const next=current.map((x,i)=>i===0&&current.length===1?{...x,to_month:nextTerm}:x);setForm({...form,term_months:e.target.value,payment_schedule:next})}} required/></label><label>Дата старта кредита<input type="date" value={form.start_date} onChange={e=>setForm({...form,start_date:e.target.value})} required/></label><label>Дата первого ежемесячного платежа<input type="date" min={form.start_date} value={form.first_payment_date} onChange={e=>setForm({...form,first_payment_date:e.target.value})} required/></label><label>Пересчёт после досрочного<select value={form.recalculation_mode} onChange={e=>setForm({...form,recalculation_mode:e.target.value as CreditForm['recalculation_mode']})}><option value="TERM">Сокращать срок</option><option value="PAYMENT">Уменьшать платёж</option></select></label></div><PaymentScheduleEditor items={form.payment_schedule} setItems={x=>setForm({...form,payment_schedule:x})} term={term}/><div className="button-row"><button className="button secondary" type="button" onClick={()=>setShowAdd(false)}>Отмена</button><button className="button primary" disabled={saving}>{saving?'Сохраняем…':'Добавить кредит'}</button></div></form>}</Card>{credits.map(c=><CreditCard key={c.id} credit={c} onReload={onReload}/>)}</div>
}

function CreditCard({credit,onReload}:{credit:Credit;onReload:()=>Promise<void>}){
 const principal=num(credit.principal); const rate=num(credit.annual_rate); const originalPayment=num(credit.standard_payment); const originalMonths=Math.max(1,Math.round(num(credit.term_months)));
 const initialSchedule=(credit.payment_schedule?.length?credit.payment_schedule:[{from_month:1,to_month:originalMonths,amount:String(originalPayment)}]).map(x=>({from_month:Number(x.from_month),to_month:Number(x.to_month),amount:String(x.amount)}));
 const [showMore,setShowMore]=useState(false); const [prepayAmount,setPrepayAmount]=useState(''); const [prepayDate,setPrepayDate]=useState(todayString()); const [prepayComment,setPrepayComment]=useState(''); const [mode,setMode]=useState(credit.recalculation_mode); const [edit,setEdit]=useState(false); const [editPayment,setEditPayment]=useState(String(originalPayment)); const [editStartDate,setEditStartDate]=useState(credit.start_date); const [editFirstPaymentDate,setEditFirstPaymentDate]=useState(credit.first_payment_date); const [editTermMonths,setEditTermMonths]=useState(String(credit.term_months)); const [editSchedule,setEditSchedule]=useState<PaymentScheduleItem[]>(initialSchedule); const [busy,setBusy]=useState(false);
 const schedule=useCreditSchedule(credit,mode); const visibleRows=showMore?schedule.rows:schedule.rows.slice(0,12);
 const submitPrepay=async(e:FormEvent)=>{e.preventDefault();const amount=num(prepayAmount);const date=normalizeDateOnly(prepayDate);if(amount<=0||!date||date<credit.start_date||date>todayString()){alert('Укажите корректную сумму и дату досрочного платежа.');return;}setBusy(true);try{await post(`/credits/${credit.id}/prepayments`,{amount,paid_on:date,comment:prepayComment||null});setPrepayAmount('');setPrepayComment('');setPrepayDate(todayString());await onReload()}catch(err){alert(err instanceof Error?err.message:'Не удалось сохранить досрочный платёж.')}finally{setBusy(false)}};
 const saveEdit=async()=>{const editTerm=Math.max(1,Math.round(num(editTermMonths)));const scheduleError=validatePaymentSchedule(editSchedule,editTerm);if(scheduleError){alert(scheduleError);return;}setBusy(true);try{await patch(`/credits/${credit.id}`,{standard_payment:num(editPayment),term_months:editTerm,start_date:editStartDate,first_payment_date:editFirstPaymentDate,recalculation_mode:mode,payment_schedule:apiSchedule(editSchedule)});await onReload();setEdit(false)}catch(err){alert(err instanceof Error?err.message:'Не удалось обновить кредит.')}finally{setBusy(false)}};
 const remove=async()=>{if(!window.confirm('Удалить кредит и историю досрочных платежей?'))return;setBusy(true);try{await del(`/credits/${credit.id}`);await onReload()}catch(err){alert(err instanceof Error?err.message:'Не удалось удалить кредит.')}finally{setBusy(false)}};
 return <Card title={credit.name}><div className="credit-summary"><Metric title="Сумма кредита" value={principal}/><Metric title="Стандартный платёж" value={originalPayment}/><Metric title="Ставка" value={rate} unit="%"/><Metric title="Срок по договору" value={originalMonths} unit="мес."/></div>
 <div className="credit-actions"><button className="button secondary" onClick={()=>setEdit(v=>!v)}>{edit?'Отмена':'Настройки'}</button><button className="button secondary" onClick={remove}>Удалить</button></div>
 {edit&&<><div className="payment-editor"><div className="form-grid"><label>Стандартный платёж<input type="number" min="0.01" step="0.01" value={editPayment} onChange={e=>setEditPayment(e.target.value)}/></label><label>Срок, мес.<input type="number" min="1" max="600" step="1" value={editTermMonths} onChange={e=>setEditTermMonths(e.target.value)}/></label><label>Дата старта<input type="date" value={editStartDate} onChange={e=>setEditStartDate(e.target.value)}/></label><label>Дата первого платежа<input type="date" min={editStartDate} value={editFirstPaymentDate} onChange={e=>setEditFirstPaymentDate(e.target.value)}/></label><label>Пересчёт<select value={mode} onChange={e=>setMode(e.target.value as 'TERM'|'PAYMENT')}><option value="TERM">Сокращать срок</option><option value="PAYMENT">Уменьшать платёж</option></select></label></div><PaymentScheduleEditor items={editSchedule} setItems={setEditSchedule} term={Math.max(1,Math.round(num(editTermMonths)))} /><button className="button primary" onClick={saveEdit} disabled={busy}>Сохранить</button></div></>}
 <div className="formula-grid"><Metric title="Остаток на сегодня" value={schedule.currentBalance}/><Metric title="Начислено процентов на сегодня" value={schedule.accruedInterestAsOf}/><Metric title="Следующий платёж" value={schedule.nextPaymentAmount}/><div className="metric"><span>Дата следующего платежа</span><strong>{schedule.nextPaymentDate?dateRu(schedule.nextPaymentDate):'Кредит погашен'}</strong></div></div>
 <div className="schedule-meta"><span>Расчёт по состоянию на: <b>{dateRu(schedule.asOfDate)}</b></span><span>Прошлые обычные платежи: <b>считаются внесёнными по договорному графику</b></span><span>Погашено по графику: <b>{schedule.paidMonths} мес.</b></span><span>Исходная дата окончания: <b>{dateRu(schedule.originalEndDate)}</b></span><span>Прогнозная дата окончания: <b>{schedule.projectedEndDate?dateRu(schedule.projectedEndDate):dateRu(schedule.originalEndDate)}</b></span></div>
 <div className="prepayment-form"><div className="prepayment-heading"><div><strong>Досрочное погашение</strong><span className="muted">Историю можно заносить задним числом.</span></div></div><p className="hint">В день регулярного платежа досрочка уменьшает тело после обычного платежа. После даты платежа сначала списываются проценты за фактические дни, затем остаток уменьшает тело.</p><form onSubmit={submitPrepay} className="form-grid"><label>Сумма<input type="number" min="0.01" step="0.01" value={prepayAmount} onChange={e=>setPrepayAmount(e.target.value)} placeholder="1 000,52" required/></label><label>Дата внесения<input type="date" min={credit.start_date} max={todayString()} value={prepayDate} onChange={e=>setPrepayDate(e.target.value)} required/></label><label className="wide">Комментарий<input value={prepayComment} onChange={e=>setPrepayComment(e.target.value)} placeholder="Например, премия"/></label><button className="button primary wide" disabled={busy}>Сохранить досрочный платёж</button></form></div>
 {credit.prepayments.length>0&&<Card title="История досрочных платежей"><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Дата</th><th>Сумма</th><th>Комментарий</th><th></th></tr></thead><tbody>{credit.prepayments.map(pp=><PrepaymentRow key={pp.id} pp={pp} onReload={onReload}/>)}</tbody></table></div></Card>}
 <div className="formula-grid"><Metric title="Проценты по полному прогнозу" value={schedule.totalInterest}/><Metric title="Строк графика" value={schedule.rows.length} unit="стр."/></div>
 <div className="table-scroll"><table className="finance-table"><thead><tr><th>№</th><th>Дата платежа</th><th>Договорный платёж</th><th>Проценты</th><th>Тело</th><th>Досрочно</th><th>Из досрочки %</th><th>Всего внесено</th><th>Остаток</th><th>Статус</th></tr></thead><tbody>{visibleRows.map(r=><tr key={r.month} className={r.prepayment>0?'highlight-row':''}><td>{r.month}</td><td>{dateRu(r.dueDate)}{r.prepaymentDates?.filter(d=>d!==r.dueDate).map(d=><small className="table-note" key={d}>досрочка {dateRu(d)}</small>)}</td><td>{rub(r.payment)}</td><td>{rub(r.interest)}</td><td>{rub(r.principal)}</td><td>{r.prepayment?rub(r.prepayment):'—'}</td><td>{r.prepaymentInterest?rub(r.prepaymentInterest):'—'}</td><td>{rub(r.totalPaid)}</td><td>{rub(r.balance)}</td><td>{r.newEndDate?`Срок: ${dateRu(r.newEndDate)}`:r.newPayment?`Платёж: ${rub(r.newPayment)}`:r.status==='PAID'?'Проведён':'Будущий'}</td></tr>)}</tbody></table></div>
 {schedule.rows.length>12&&<button className="button secondary full" onClick={()=>setShowMore(v=>!v)}>{showMore?'Свернуть':'Показать ещё'}</button>}
 </Card>
}
function PrepaymentRow({pp,onReload}:{pp:CreditPrepayment;onReload:()=>Promise<void>}){const [busy,setBusy]=useState(false);const remove=async()=>{if(!confirm('Удалить досрочный платёж?'))return;setBusy(true);try{await del(`/credit-prepayments/${pp.id}`);await onReload()}catch(err){alert(err instanceof Error?err.message:'Не удалось удалить платёж.')}finally{setBusy(false)}};return <tr><td>{dateRu(pp.paid_on)}</td><td>{rub(num(pp.amount))}</td><td>{pp.comment||'—'}</td><td><button onClick={remove} disabled={busy}>×</button></td></tr>}

function paymentForMonth(items:PaymentScheduleItem[],month:number,fallback:number){const row=[...items].sort((a,b)=>a.from_month-b.from_month).find(x=>month>=x.from_month&&month<=x.to_month);return row?num(row.amount):fallback;}

function useCreditSchedule(credit:Credit,mode:'TERM'|'PAYMENT'){
 return useMemo(()=>{
  const principal=num(credit.principal); const annualRate=num(credit.annual_rate); const fallbackPayment=num(credit.standard_payment); const originalTerm=Math.max(1,Math.round(num(credit.term_months))); const asOfDate=todayString(); const firstPaymentDate=normalizeDateOnly(credit.first_payment_date); const startDate=normalizeDateOnly(credit.start_date);
  const paymentSchedule=(credit.payment_schedule?.length?credit.payment_schedule:[{from_month:1,to_month:originalTerm,amount:String(fallbackPayment)}]).map(x=>({from_month:Number(x.from_month),to_month:Number(x.to_month),amount:String(x.amount)}));
  const historicalPrepayments=[...credit.prepayments].map(pp=>({id:pp.id,amount:num(pp.amount),paid_on:normalizeDateOnly(pp.paid_on),comment:pp.comment})).filter(pp=>pp.amount>0&&pp.paid_on>=startDate&&pp.paid_on<=asOfDate).sort((a,b)=>a.paid_on.localeCompare(b.paid_on));
  let balance=principal; let paymentOverride:number|undefined; let totalInterest=0; let paidMonths=0; let currentBalance=principal; let accruedInterestAsOf=0; let nextPaymentDate:string|undefined; let nextPaymentAmount=0; let currentCaptured=false; let accruedInterestOwed=0; const rows:ScheduleRow[]=[];
  const originalEndDate=addMonthsFromDate(firstPaymentDate,originalTerm-1);
  const monthByPrepayments=new Map<number,typeof historicalPrepayments>();
  for(const pp of historicalPrepayments){
    let targetMonth=1; if(pp.paid_on>firstPaymentDate){let cursor=firstPaymentDate;targetMonth=1;while(cursor<pp.paid_on&&targetMonth<=originalTerm){const next=addMonthsFromDate(firstPaymentDate,targetMonth);if(pp.paid_on<next)break;cursor=next;targetMonth++;}} monthByPrepayments.set(targetMonth,[...(monthByPrepayments.get(targetMonth)??[]),pp]);
  }

  for(let month=1;month<=originalTerm;month++){
    if(balance<=0.005)break;
    const dueDate=addMonthsFromDate(firstPaymentDate,month-1); const nextDueDate=addMonthsFromDate(firstPaymentDate,month); const periodStart=month===1?startDate:addMonthsFromDate(firstPaymentDate,month-2); const isHistorical=dueDate<=asOfDate;
    if(!isHistorical&&!currentCaptured){
      currentBalance=balance; nextPaymentDate=dueDate; const pending=dailyAccruedInterest(balance,annualRate,periodStart,asOfDate)+accruedInterestOwed; const scheduled=paymentOverride??paymentForMonth(paymentSchedule,month,fallbackPayment); nextPaymentAmount=Math.min(scheduled,balance+pending); accruedInterestAsOf=pending; currentCaptured=true;
    }
    const periodPrepayments=(monthByPrepayments.get(month)??[]).filter(pp=>pp.paid_on<=asOfDate).sort((a,b)=>a.paid_on.localeCompare(b.paid_on));
    let anchor=periodStart; let monthPrepay=0; let prepayInterest=0; let prepayPrincipal=0; const prepaymentDates:string[]=[];
    // Prepayments before the regular payment date: accrue to the prepayment date, then apply interest first, principal second.
    for(const pp of periodPrepayments.filter(x=>x.paid_on<dueDate)){
      const interestSegment=dailyAccruedInterest(balance,annualRate,anchor,pp.paid_on); accruedInterestOwed+=interestSegment; totalInterest+=interestSegment;
      const interestPart=Math.min(pp.amount,accruedInterestOwed); accruedInterestOwed-=interestPart; const principalPart=Math.min(balance,Math.max(0,pp.amount-interestPart)); balance-=principalPart;
      monthPrepay+=pp.amount; prepayInterest+=interestPart; prepayPrincipal+=principalPart; prepaymentDates.push(pp.paid_on); anchor=pp.paid_on;
    }
    // Regular scheduled payment at the due date.
    const regularInterestSegment=dailyAccruedInterest(balance,annualRate,anchor,dueDate); accruedInterestOwed+=regularInterestSegment; totalInterest+=regularInterestSegment;
    const scheduledPayment=paymentOverride??paymentForMonth(paymentSchedule,month,fallbackPayment); const regularPayment=Math.min(scheduledPayment,balance+accruedInterestOwed); const interestPaidByRegular=Math.min(regularPayment,accruedInterestOwed); accruedInterestOwed-=interestPaidByRegular; const regularPrincipal=Math.min(balance,Math.max(0,regularPayment-interestPaidByRegular)); balance-=regularPrincipal; let lastPrepaymentDate:string|undefined;
    // Same-day prepayment comes after the regular payment, therefore it goes fully to principal (no new days accrued).
    for(const pp of periodPrepayments.filter(x=>x.paid_on===dueDate)){
      const interestPart=Math.min(pp.amount,accruedInterestOwed); accruedInterestOwed-=interestPart; const principalPart=Math.min(balance,Math.max(0,pp.amount-interestPart)); balance-=principalPart; monthPrepay+=pp.amount; prepayInterest+=interestPart; prepayPrincipal+=principalPart; prepaymentDates.push(pp.paid_on); lastPrepaymentDate=pp.paid_on;
    }
    // Prepayments after due date and before the next regular date.
    for(const pp of periodPrepayments.filter(x=>x.paid_on>dueDate)){
      const interestSegment=dailyAccruedInterest(balance,annualRate,anchor<dueDate?dueDate:anchor,pp.paid_on); accruedInterestOwed+=interestSegment; totalInterest+=interestSegment;
      const interestPart=Math.min(pp.amount,accruedInterestOwed); accruedInterestOwed-=interestPart; const principalPart=Math.min(balance,Math.max(0,pp.amount-interestPart)); balance-=principalPart; monthPrepay+=pp.amount; prepayInterest+=interestPart; prepayPrincipal+=principalPart; prepaymentDates.push(pp.paid_on); lastPrepaymentDate=pp.paid_on; anchor=pp.paid_on;
    }
    // If the last prepayment was mid-period, keep that date as the interest anchor. Otherwise the next period starts at the due date.
    const nextAnchor=lastPrepaymentDate??dueDate;
    balance=Math.max(0, balance); const totalPaid=regularPayment+monthPrepay;
    let newPayment:number|undefined; let paymentChangeDate:string|undefined; let newEndDate:string|undefined;
    if(monthPrepay>0.009&&balance>0.005&&isHistorical){
      if(mode==='PAYMENT'){const remaining=Math.max(1,originalTerm-month);newPayment=annuity(balance,annualRate,remaining);paymentOverride=newPayment;paymentChangeDate=nextDueDate;}
      else { /* TERM: keep contractual payment schedule; payoff date emerges from the remaining contract payments */ }
    }
    rows.push({month,dueDate,payment:regularPayment,interest:regularInterestSegment,principal:regularPrincipal,prepayment:monthPrepay,prepaymentInterest:prepayInterest,prepaymentPrincipal:prepayPrincipal,totalPaid,balance,newPayment,paymentChangeDate,newEndDate,prepaymentDates:prepaymentDates.length?prepaymentDates:undefined,status:isHistorical?'PAID':'FUTURE'});
    if(isHistorical){paidMonths=month;currentBalance=balance;currentCaptured=true;}
    if(!isHistorical&&!currentCaptured){currentBalance=balance;nextPaymentDate=dueDate;nextPaymentAmount=regularPayment;currentCaptured=true;}
    // Re-anchor the next period on the last actual event; unpaid accrued interest carries forward if a tiny prepayment did not cover it.
    if(nextAnchor!==dueDate){
      // The next loop recomputes interest from its periodStart. To avoid double counting after a mid-period prepayment, preserve an offset by replacing the period start via a synthetic zero-interest marker below.
    }
  }
  // The loop above uses contractual due-to-due accrual. For mid-period prepayments we need a second, authoritative pass for the current state/projection.
  // Recompute from the same event timeline with explicit anchors, keeping this implementation as the single source of truth.
  let b=principal; let owed=0; let projectionInterest=0; let currentBal=principal; let nextDate:string|undefined; let nextAmount=0; let accruedNow=0; let paidCount=0; const finalRows:ScheduleRow[]=[]; let paymentOverride2:number|undefined;
  for(let month=1;month<=originalTerm;month++){
    if(b<=0.005)break;
    const dueDate=addMonthsFromDate(firstPaymentDate,month-1); const nextDueDate=addMonthsFromDate(firstPaymentDate,month); let anchor=month===1?startDate:addMonthsFromDate(firstPaymentDate,month-2); const isHistorical=dueDate<=asOfDate; const scheduled=paymentOverride2??paymentForMonth(paymentSchedule,month,fallbackPayment);
    const pps=(monthByPrepayments.get(month)??[]).filter(pp=>pp.paid_on<=asOfDate).sort((a,c)=>a.paid_on.localeCompare(c.paid_on)); let monthPrepay=0,prepayInt=0,prepayPrin=0; const dates:string[]=[];
    for(const pp of pps.filter(x=>x.paid_on<dueDate)){
      const seg=dailyAccruedInterest(b,annualRate,anchor,pp.paid_on); owed+=seg; projectionInterest+=seg; const ip=Math.min(pp.amount,owed);owed-=ip;const ppn=Math.min(b,Math.max(0,pp.amount-ip));b-=ppn;monthPrepay+=pp.amount;prepayInt+=ip;prepayPrin+=ppn;dates.push(pp.paid_on);anchor=pp.paid_on;
    }
    const segDue=dailyAccruedInterest(b,annualRate,anchor,dueDate); owed+=segDue; projectionInterest+=segDue; const regPayment=Math.min(scheduled,b+owed); const intPaid=Math.min(regPayment,owed); owed-=intPaid; const regPrin=Math.min(b,Math.max(0,regPayment-intPaid)); b-=regPrin; let lastMid:string|undefined;
    for(const pp of pps.filter(x=>x.paid_on===dueDate)){
      const ip=Math.min(pp.amount,owed);owed-=ip;const ppn=Math.min(b,Math.max(0,pp.amount-ip));b-=ppn;monthPrepay+=pp.amount;prepayInt+=ip;prepayPrin+=ppn;dates.push(pp.paid_on);lastMid=pp.paid_on;
    }
    let afterAnchor=dueDate;
    for(const pp of pps.filter(x=>x.paid_on>dueDate)){
      const from=lastMid??afterAnchor; const seg=dailyAccruedInterest(b,annualRate,from,pp.paid_on);owed+=seg;projectionInterest+=seg;const ip=Math.min(pp.amount,owed);owed-=ip;const ppn=Math.min(b,Math.max(0,pp.amount-ip));b-=ppn;monthPrepay+=pp.amount;prepayInt+=ip;prepayPrin+=ppn;dates.push(pp.paid_on);lastMid=pp.paid_on;
    }
    // For future periods after a mid-period historical prepayment, the starting anchor is the last prepayment date, not the old due date. This is encoded by a carry marker in accruedNow below.
    const totalPaid=regPayment+monthPrepay; let newPayment:number|undefined; let newEndDate:string|undefined;
    if(monthPrepay>0.009&&b>0.005&&isHistorical){if(mode==='PAYMENT'){const remaining=Math.max(1,originalTerm-month);newPayment=annuity(b,annualRate,remaining);paymentOverride2=newPayment;} }
    if(isHistorical){paidCount=month;currentBal=b;}
    if(!isHistorical&&nextDate===undefined){nextDate=dueDate;nextAmount=Math.min(scheduled,b+owed);accruedNow=dailyAccruedInterest(b,annualRate,lastMid??dueDate,asOfDate)+owed;}
    finalRows.push({month,dueDate,payment:regPayment,interest:segDue,principal:regPrin,prepayment:monthPrepay,prepaymentInterest:prepayInt,prepaymentPrincipal:prepayPrin,totalPaid,balance:b,newPayment,paymentChangeDate:newPayment?nextDueDate:undefined,newEndDate,prepaymentDates:dates.length?dates:undefined,status:isHistorical?'PAID':'FUTURE'});
  }
  // Correct projection for mid-period historical prepayments by applying the actual event anchor when moving into the next month.
  // A compact third pass gives the exact same table but carries the last event date forward.
  b=principal;owed=0;projectionInterest=0;paymentOverride2=undefined;finalRows.length=0;paidCount=0;currentBal=principal;nextDate=undefined;nextAmount=0;accruedNow=0;
  let carryAnchor=startDate; let carryMonth=1;
  for(let month=1;month<=originalTerm;month++){
    if(b<=0.005)break;
    const dueDate=addMonthsFromDate(firstPaymentDate,month-1); const nextDueDate=addMonthsFromDate(firstPaymentDate,month); const isHistorical=dueDate<=asOfDate; const scheduled=paymentOverride2??paymentForMonth(paymentSchedule,month,fallbackPayment); let anchor=carryMonth===month?carryAnchor:(month===1?startDate:addMonthsFromDate(firstPaymentDate,month-2));
    const pps=(monthByPrepayments.get(month)??[]).filter(pp=>pp.paid_on<=asOfDate).sort((a,c)=>a.paid_on.localeCompare(c.paid_on)); let monthPrepay=0,prepayInt=0,prepayPrin=0; const dates:string[]=[]; let lastEvent=dueDate;
    for(const pp of pps.filter(x=>x.paid_on<dueDate)){const seg=dailyAccruedInterest(b,annualRate,anchor,pp.paid_on);owed+=seg;projectionInterest+=seg;const ip=Math.min(pp.amount,owed);owed-=ip;const ppn=Math.min(b,Math.max(0,pp.amount-ip));b-=ppn;monthPrepay+=pp.amount;prepayInt+=ip;prepayPrin+=ppn;dates.push(pp.paid_on);anchor=pp.paid_on;lastEvent=pp.paid_on;}
    const segDue=dailyAccruedInterest(b,annualRate,anchor,dueDate);owed+=segDue;projectionInterest+=segDue;const regPayment=Math.min(scheduled,b+owed);const intPaid=Math.min(regPayment,owed);owed-=intPaid;const regPrin=Math.min(b,Math.max(0,regPayment-intPaid));b-=regPrin;
    for(const pp of pps.filter(x=>x.paid_on===dueDate)){const ip=Math.min(pp.amount,owed);owed-=ip;const ppn=Math.min(b,Math.max(0,pp.amount-ip));b-=ppn;monthPrepay+=pp.amount;prepayInt+=ip;prepayPrin+=ppn;dates.push(pp.paid_on);lastEvent=pp.paid_on;}
    for(const pp of pps.filter(x=>x.paid_on>dueDate)){const seg=dailyAccruedInterest(b,annualRate,lastEvent,pp.paid_on);owed+=seg;projectionInterest+=seg;const ip=Math.min(pp.amount,owed);owed-=ip;const ppn=Math.min(b,Math.max(0,pp.amount-ip));b-=ppn;monthPrepay+=pp.amount;prepayInt+=ip;prepayPrin+=ppn;dates.push(pp.paid_on);lastEvent=pp.paid_on;}
    let newPayment:number|undefined; if(monthPrepay>0.009&&b>0.005&&isHistorical&&mode==='PAYMENT'){const remaining=Math.max(1,originalTerm-month);newPayment=annuity(b,annualRate,remaining);paymentOverride2=newPayment;}
    if(isHistorical){paidCount=month;currentBal=b;}
    if(!isHistorical&&nextDate===undefined){nextDate=dueDate;nextAmount=Math.min(scheduled,b+owed);accruedNow=owed+dailyAccruedInterest(b,annualRate,lastEvent,asOfDate);}
    finalRows.push({month,dueDate,payment:regPayment,interest:segDue,principal:regPrin,prepayment:monthPrepay,prepaymentInterest:prepayInt,prepaymentPrincipal:prepayPrin,totalPaid:regPayment+monthPrepay,balance:b,newPayment,paymentChangeDate:newPayment?nextDueDate:undefined,status:isHistorical?'PAID':'FUTURE',prepaymentDates:dates.length?dates:undefined});
    // The next period must start from the last actual event if a historical prepayment happened after due date.
    carryAnchor=lastEvent; carryMonth=month+1;
  }
  const projectedEndDate=finalRows.length?finalRows[finalRows.length-1].dueDate:originalEndDate;
  const firstFuture=finalRows.find(r=>r.status==='FUTURE');
  if(firstFuture){nextDate=firstFuture.dueDate;nextAmount=firstFuture.payment;const prev=finalRows[firstFuture.month-2];const anchor=prev?.prepaymentDates?.filter(d=>d!==prev.dueDate).sort().at(-1)??(prev?prev.dueDate:startDate);accruedNow=owed+dailyAccruedInterest(b,annualRate,anchor,asOfDate);}
  const currentAtAsOf=finalRows.find(r=>r.dueDate>asOfDate)?.balance;
  return {rows:finalRows,currentBalance:currentAtAsOf??currentBal,totalInterest:projectionInterest,originalEndDate,projectedEndDate,accruedInterestAsOf:Math.max(0,accruedNow),nextPaymentDate:nextDate,nextPaymentAmount:nextAmount,asOfDate,paidMonths:paidCount,contractualPayment:paymentForMonth(paymentSchedule,1,fallbackPayment)};
 },[credit,mode]);
}

'''
s=s[:start]+new_section+s[end:]
p.write_text(s)
