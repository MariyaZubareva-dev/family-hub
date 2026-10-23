import {useState} from 'react'
import {Field,Help,Modal,request} from './FinanceScreen'

const today=()=>new Date().toLocaleDateString('sv-SE')
const date=(v:string)=>new Date(v.slice(0,10)+'T12:00:00').toLocaleDateString('ru-RU')
const money=(v:number)=>`${Number(v).toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽`
type Scheduled={date:string;payment:number;principal?:number;interest?:number;fees?:number;status:string;paid_amount:number;remaining_amount:number;paid_on?:string;source?:string}
function rowsFor(credit:any):Scheduled[]{
  if(credit.summary?.regular_schedule)return credit.summary.regular_schedule
  const rows:any[]=[...(credit.bank_schedule?.rows||[])]
  if(!rows.length){
    const first=new Date(credit.first_payment_date.slice(0,10)+'T12:00:00')
    for(let i=0;i<credit.term_months;i++){
      const d=new Date(first.getFullYear(),first.getMonth()+i+1,0,12);d.setDate(Math.min(first.getDate(),d.getDate()))
      const segment=credit.payment_schedule?.find((s:any)=>i+1>=s.from_month&&i+1<=s.to_month)
      rows.push({date:d.toLocaleDateString('sv-SE'),payment:Number(segment?.amount??credit.standard_payment),source:'CONTRACT'})
    }
  }
  const payments=credit.payments||[]
  for(const p of payments){
    const day=p.scheduled_on.slice(0,10)
    if(!rows.some(r=>r.date===day))rows.push({date:day,payment:payments.filter((v:any)=>v.scheduled_on.slice(0,10)===day).reduce((s:number,v:any)=>s+Number(v.amount),0),source:'JOURNAL'})
  }
  return rows.map(r=>{
    const entries=payments.filter((p:any)=>p.scheduled_on.slice(0,10)===r.date),paid=entries.reduce((s:number,p:any)=>s+Number(p.amount),0)
    return {...r,paid_amount:paid,remaining_amount:Math.max(0,Math.round((r.payment-paid)*100)/100),status:paid>=r.payment?'PAID':paid>0?'PARTIAL':r.date<today()?'OVERDUE':'UPCOMING',paid_on:entries.map((p:any)=>p.paid_on.slice(0,10)).sort().at(-1)}
  }).sort((a,b)=>a.date.localeCompare(b.date))
}
export default function CreditRegularSchedule({credit,admin,onSaved,onEdit}:{credit:any;admin:boolean;onSaved:()=>Promise<void>;onEdit:(p:any)=>void}){
  const [filter,setFilter]=useState('pending'),[limit,setLimit]=useState(6),[expanded,setExpanded]=useState('')
  const [marking,setMarking]=useState<Scheduled|null>(null),[paidOn,setPaidOn]=useState(today()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const rows=rowsFor(credit),shown=rows.filter(r=>filter==='all'||(filter==='paid'?r.status==='PAID':r.status!=='PAID'&&(filter==='past'?r.date<today():r.date>=today())))
  const save=async()=>{
    if(!marking||busy)return
    setBusy(true);setError('')
    try{await request(`/credits/${credit.id}/schedule-payment`,'PUT',{scheduled_on:marking.date,paid_on:paidOn,paid:marking.status!=='PAID',base_version:credit.bank_schedule?.version||0});await onSaved();setNotice(marking.status==='PAID'?'Отметка оплаты снята.':`Платёж за ${date(marking.date)} отмечен как оплаченный.`);setMarking(null)}
    catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить отметку. Попробуйте ещё раз.')}
    finally{setBusy(false)}
  }
  return <div className="credit-regular-schedule">
    {notice&&<p role="status" className="credit-pdf-note">{notice}</p>}
    <div className="credit-schedule-toolbar"><Field label="Показать платежи"><select value={filter} onChange={e=>{setFilter(e.target.value);setLimit(6)}}><option value="pending">Предстоит</option><option value="paid">Оплачено</option><option value="past">Не отмечены</option><option value="all">Все</option></select></Field><Help text="Галочка относится к выбранной дате графика. Дату фактической оплаты можно изменить — это не перенесёт отметку на другой месяц. Снятие галочки удаляет записи оплаты за выбранный период после подтверждения."/></div>
    <div className="credit-schedule-list" role="list" aria-label="Регулярные платежи по графику">{shown.slice(0,limit).map(r=><div className="credit-schedule-item" role="listitem" key={r.date}>
      <div className="credit-schedule-line"><input type="checkbox" aria-label={`Оплачен платёж ${date(r.date)}`} checked={r.status==='PAID'} disabled={!admin||busy} onChange={()=>{setError('');setPaidOn(today());setMarking(r)}}/>
        <button type="button" className="credit-schedule-date" aria-expanded={expanded===r.date} onClick={()=>setExpanded(expanded===r.date?'':r.date)}><time>{date(r.date)}</time><small>{r.status==='PAID'?'Оплачен':r.status==='PARTIAL'?'Частично':r.status==='OVERDUE'?'Не отмечен':'Предстоит'}</small></button>
        <div className="credit-schedule-amount"><b>{money(r.payment)}</b>{r.status==='PARTIAL'&&<small>Осталось {money(r.remaining_amount)}</small>}{r.paid_on&&<small>Оплата {date(r.paid_on)}</small>}</div>
      </div>
      {expanded===r.date&&<div className="credit-schedule-extra">{r.source==='JOURNAL'?<small>Запись журнала вне загруженной части графика.</small>:<div className="credit-schedule-breakdown">{r.principal!=null&&<span>Долг {money(r.principal)}</span>}{r.interest!=null&&<span>Проценты {money(r.interest)}</span>}{Number(r.fees)>0&&<span>Услуги {money(r.fees!)}</span>}</div>}{(credit.payments||[]).filter((p:any)=>p.scheduled_on.slice(0,10)===r.date).map((p:any)=><div className="credit-schedule-receipt" key={p.id}><span>{date(p.paid_on)} · {money(p.amount)}</span>{admin&&<button className="credit-manual-payment" onClick={()=>onEdit(p)} aria-label={`Изменить оплату от ${date(p.paid_on)}`}>Изменить</button>}</div>)}</div>}
    </div>)}</div>
    {!shown.length&&<p className="f-empty">{filter==='paid'?'Оплаченных платежей пока нет.':'Нет платежей в выбранном списке.'}</p>}
    {shown.length>limit&&<button type="button" className="button secondary" onClick={()=>setLimit(limit+12)}>Показать ещё · {shown.length-limit}</button>}
    {marking&&<Modal title={marking.status==='PAID'?'Снять отметку оплаты?':'Отметить оплату'} onClose={()=>setMarking(null)} busy={busy}><form className="f-form" onSubmit={e=>{e.preventDefault();void save()}}>
      <div className="f-row"><span>Платёж по графику</span><b>{date(marking.date)}</b></div><div className="f-row"><span>{marking.status==='PAID'?'Внесено за период':'К оплате'}</span><b>{money(marking.status==='PAID'?marking.paid_amount:marking.remaining_amount)}</b></div>
      {marking.status==='PAID'?<p className="credit-pdf-note">Удалить записи регулярной оплаты за эту дату графика? Досрочные платежи и расходы бюджета сохранятся.</p>:<Field label="Дата фактической оплаты"><input required type="date" min={credit.start_date.slice(0,10)} max={today()} value={paidOn} onChange={e=>setPaidOn(e.target.value)}/></Field>}
      {error&&<p role="alert">{error}</p>}<button className="button primary" disabled={busy}>{marking.status==='PAID'?'Снять отметку':'Оплачено'}</button>
      {marking.status!=='PAID'&&<button type="button" className="button secondary" disabled={busy} onClick={()=>{onEdit({paid_on:paidOn,scheduled_on:marking.date,amount:marking.remaining_amount,comment:'',period_locked:true});setMarking(null)}}>Внести другую сумму</button>}
    </form></Modal>}
  </div>
}
