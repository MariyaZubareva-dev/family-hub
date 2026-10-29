import { useEffect, useRef, useState } from 'react'
import { Help, Modal } from './FinanceScreen'
import { DEFAULT_TIMEZONE, zoneInput, zoneParts } from './lib/timezone'
import './home.css'
import { calendarRequest } from './lib/calendarApi'
import { CashbackSummary } from './CashbackScreen'

type Props={apiGet:(path:string)=>Promise<any>;visibility:{calendar:boolean;finance:boolean;shopping:boolean};onCalendar:(kind?:'EVENT'|'REMINDER')=>void;onFinance:(tab:'overview'|'credits'|'cashback')=>void;onReceipt:(file:File)=>void;onFamily:()=>void}
const money=(n:unknown)=>Number(n||0).toLocaleString('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2})
const colors=['#0F766E','#56A99A','#92C7B8','#E7B874','#B799BD','#7894B4']
function Symbol({kind}:{kind:'camera'|'calendar'|'wallet'}){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={kind==='camera'?'M3 7h4l2-3h6l2 3h4v14H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0':kind==='calendar'?'M5 5h14v16H5z M8 3v4 M16 3v4 M5 10h14 M8 14h2 M14 14h2':'M3 6h18v14H3z M3 10h18 M15 15h3 M6 3h12'}/></svg>}
export default function HomeScreen(p:Props){
  const [analytics,setAnalytics]=useState<any>(null),[events,setEvents]=useState<any[]>([]),[reminders,setReminders]=useState<any[]>([]),[credits,setCredits]=useState<any[]>([])
  const [timezone,setTimezone]=useState(DEFAULT_TIMEZONE),[loading,setLoading]=useState(true),[errors,setErrors]=useState<string[]>([]),[adding,setAdding]=useState(false),[retry,setRetry]=useState(0)
  const reminderLock=useRef(false)
  const [reminderBusy,setReminderBusy]=useState(false),[reminderError,setReminderError]=useState(''),[completedReminder,setCompletedReminder]=useState<any>(null)
  const changeReminder=async(item:any,status:'COMPLETED'|'SCHEDULED')=>{
    if(reminderLock.current)return
    reminderLock.current=true;setReminderBusy(true);setReminderError('')
    try{const j=await calendarRequest('/reminders/'+item.id,{status},'PATCH');setReminders(rows=>rows.map(x=>x.id===item.id?j.data:x));setCompletedReminder(status==='COMPLETED'?j.data:null)}
    catch(e){setReminderError(e instanceof Error?e.message:'Не удалось изменить напоминание.')}finally{reminderLock.current=false;setReminderBusy(false)}
  }
  const [choosingReceipt,setChoosingReceipt]=useState(false)
  const takeReceipt=(file?:File)=>{if(file){setChoosingReceipt(false);p.onReceipt(file)}}
  useEffect(()=>{
    let active=true
    const load=async()=>{
      setLoading(true);setErrors([])
      let zone=DEFAULT_TIMEZONE;const failed:string[]=[]
      try{zone=(await p.apiGet('/family')).data?.timezone||DEFAULT_TIMEZONE}catch{failed.push('Не удалось загрузить часовой пояс семьи. Время показано по Москве.')}
      const now=zoneParts(new Date(),zone)
      const jobs:[string,Promise<any>][]=[]
      if(p.visibility.finance)jobs.push(['Бюджет',p.apiGet(`/finance/analytics?period=month&year=${now.year}&month=${now.month}`)],['Кредиты',p.apiGet('/credits')])
      if(p.visibility.calendar)jobs.push(['Встречи',p.apiGet('/events')],['Напоминания',p.apiGet('/reminders')])
      const results=await Promise.allSettled(jobs.map(x=>x[1]));if(!active)return
      setTimezone(zone);setAnalytics(null);setEvents([]);setReminders([]);setCredits([])
      results.forEach((result,i)=>{const name=jobs[i][0];if(result.status==='rejected'){failed.push(`${name}: не удалось загрузить данные.`);return}const data=result.value.data;if(name==='Бюджет')setAnalytics(data);if(name==='Кредиты')setCredits(data||[]);if(name==='Встречи')setEvents(data||[]);if(name==='Напоминания')setReminders(data||[])})
      setErrors(failed);setLoading(false)
    };void load();return()=>{active=false}
  },[p.visibility.finance,p.visibility.calendar,retry])
  const today=zoneInput(new Date(),timezone).slice(0,10)
  const plans=[...events.map(x=>({...x,at:x.start_at,kind:'Встреча'})),...reminders.map(x=>({...x,at:x.scheduled_at,kind:'Напоминание'}))].filter(x=>(x.status||'SCHEDULED')==='SCHEDULED'&&Number.isFinite(Date.parse(x.at))&&zoneInput(new Date(x.at),timezone).slice(0,10)===today).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))
  const all=(analytics?.ranked||[]).map((c:any)=>({...c,amount:Number(c.amount)||0})).filter((c:any)=>c.amount>0).sort((a:any,b:any)=>b.amount-a.amount)
  const cats=all.slice(0,5);if(all.length>5)cats.push({id:'others',name:'Остальные',amount:all.slice(5).reduce((s:number,c:any)=>s+c.amount,0)})
  const sum=cats.reduce((s:number,c:any)=>s+c.amount,0);let offset=0
  const gradient=cats.map((c:any,i:number)=>{const start=offset;offset+=c.amount/sum*100;return `${colors[i]} ${start}% ${offset}%`}).join(',')
  const next=credits.map(c=>{
    if(c.summary){const next=c.summary.next_payment;return next?{...c,date:new Date(next.date+'T12:00:00'),amount:Number(next.amount)}:null}
    const [y,m,day]=String(c.first_payment_date).slice(0,10).split('-').map(Number);if(!y||!m||!day)return null
    const n=zoneParts(new Date(),timezone);const add=(i:number)=>{const ix=y*12+m-1+i,yr=Math.floor(ix/12),mo=ix%12;return new Date(yr,mo,Math.min(day,new Date(yr,mo+1,0).getDate()))}
    let i=Math.max(0,(n.year-y)*12+n.month-m);let date=add(i);if(date<new Date(n.year,n.month-1,n.day)){date=add(++i)}
    if(c.term_months&&i>=Number(c.term_months))return null
    const part=(c.payment_schedule||[]).find((x:any)=>i+1>=Number(x.from_month)&&i+1<=Number(x.to_month));return {...c,date,amount:Number(part?.amount??c.standard_payment)}
  }).filter(Boolean).sort((a,b)=>a.date-b.date).slice(0,3)
  return <div className="home-page">
    <div className="section-title"><h2>Главная</h2><span className="h-date">{new Date().toLocaleDateString('ru-RU',{timeZone:timezone,day:'numeric',month:'long'})}</span></div>
    {errors.length>0&&<div className="h-error" role="alert">{errors.map(x=><p key={x}>{x}</p>)}<button className="button secondary" onClick={()=>setRetry(x=>x+1)}>Повторить</button></div>}
    {loading&&<p className="h-empty" role="status">Загружаем обзор…</p>}
    {p.visibility.finance&&<section className="card h-budget" aria-label="Бюджет за месяц"><div className="h-head"><span className="h-symbol"><Symbol kind="wallet"/></span><div><h3>Бюджет за месяц</h3><small>{new Date().toLocaleDateString('ru-RU',{timeZone:timezone,month:'long',year:'numeric'})}</small></div><button className="h-link" onClick={()=>p.onFinance('overview')}>Финансы →</button></div>
      {analytics&&<><div className="h-chart" aria-label="Расходы по категориям"><div className="h-donut" role="img" aria-label={`Расходы по категориям, всего ${money(sum)}`} style={{background:sum?`conic-gradient(${gradient})`:'#EAF0ED'}}><div><small>Расходы</small><strong>{money(sum)}</strong></div></div><ul className="h-legend">{cats.map((c:any,i:number)=><li key={c.id||c.name}><i style={{background:colors[i]}}/><span>{c.name}<small>{Math.round(c.amount/sum*100)}%</small></span><b>{money(c.amount)}</b></li>)}{!cats.length&&<li className="h-empty">Расходов пока нет</li>}</ul></div>
      <div className="h-metrics" aria-label="Итоги месяца">{[['Доход',analytics.total_income],['Расход',analytics.total_expense],['Остаток',analytics.balance]].map(([title,value])=><div key={title}><small>{title}</small><strong className={title==='Остаток'?(Number(value)<0?'h-negative':'h-positive'):''}>{money(value)}</strong></div>)}</div></>}
      <button className="button primary h-photo" onClick={()=>setChoosingReceipt(true)}><Symbol kind="camera"/>Фото чека</button>
    </section>}
    {p.visibility.finance&&<CashbackSummary onOpen={()=>p.onFinance('cashback')}/>}
    {p.visibility.calendar&&<section className="card h-plans" aria-label="Планы на сегодня"><div className="h-head"><span className="h-symbol"><Symbol kind="calendar"/></span><h3>Сегодня <span className="h-count">{plans.length}</span></h3><button className="h-link" onClick={()=>p.onCalendar()}>Календарь →</button></div>
      {!loading&&!plans.length&&!errors.some(x=>/Встречи:|Напоминания:/.test(x))&&<p className="h-empty">На сегодня планов пока нет.</p>}
      {reminderError&&<p className="h-error" role="alert">{reminderError}</p>}
      {completedReminder&&<div className="h-reminder-notice" role="status"><span>Выполнено: {completedReminder.title}</span><button className="h-link" disabled={reminderBusy} onClick={()=>void changeReminder(completedReminder,'SCHEDULED')}>Отменить</button></div>}
      {plans.map(x=><article className="h-plan" key={x.kind+x.id}>{x.kind==='Напоминание'&&<input className="h-reminder-check" type="checkbox" aria-label={'Выполнено: '+x.title} checked={false} disabled={!x.can_complete||reminderBusy} onChange={()=>void changeReminder(x,'COMPLETED')}/>}<time dateTime={x.at}>{new Date(x.at).toLocaleTimeString('ru-RU',{timeZone:timezone,hour:'2-digit',minute:'2-digit'})}</time><div><small>{x.kind}</small><strong>{x.title}</strong></div></article>)}
      <div className="h-footer"><button className="button secondary" onClick={()=>setAdding(true)}>＋ Добавить</button><Help label="Время планов" text={`Планы показаны в часовом поясе ${timezone}. Изменить его можно в разделе «Семья».`}/></div>
    </section>}
    {p.visibility.finance&&next.length>0&&<section className="card" aria-label="Ближайшие платежи"><div className="h-head"><h3>Ближайшие платежи</h3><button className="h-link" onClick={()=>p.onFinance('credits')}>Кредиты →</button></div>{next.map(c=><article key={c.id} className="h-credit"><div><strong>{c.name||'Кредит'}</strong><small>{c.date.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}</small></div><b>{money(c.amount)}</b></article>)}</section>}
    {!p.visibility.finance&&!p.visibility.calendar&&<section className="card"><button className="button secondary" onClick={p.onFamily}>Открыть семью</button></section>}
    {choosingReceipt&&<Modal title="Добавить чек" onClose={()=>setChoosingReceipt(false)}><div className="h-add"><label className="button primary cb-upload">Сфотографировать чек<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Сфотографировать чек" onChange={e=>{const file=e.target.files?.[0];e.target.value='';takeReceipt(file)}}/></label><label className="button secondary cb-upload">Загрузить с устройства<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Загрузить чек с устройства" onChange={e=>{const file=e.target.files?.[0];e.target.value='';takeReceipt(file)}}/></label></div></Modal>}
    {adding&&<Modal title="Добавить план" onClose={()=>setAdding(false)}><div className="h-add"><button className="button primary" onClick={()=>p.onCalendar('EVENT')}>＋ Встреча</button><button className="button secondary" onClick={()=>p.onCalendar('REMINDER')}>＋ Напоминание</button></div></Modal>}
  </div>
}
