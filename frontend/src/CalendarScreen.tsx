import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Field, Help, Modal } from './FinanceScreen'
import './calendar.css'
import { calendarRequest as request } from './lib/calendarApi'
import { DEFAULT_TIMEZONE, timezoneLabel, zoneInput, zoneParts, wallTimeToDate } from './lib/timezone'

type Kind='EVENT'|'REMINDER'
type Member={id:string;user?:{first_name?:string;username?:string}}
type Entry={id:string;title:string;description?:string;status:string;can_edit?:boolean;can_complete?:boolean;start_at?:string;scheduled_at?:string;responsible_member?:Member;responsible_member_ids?:string[];creator?:{first_name?:string;username?:string}}
type Row=Entry&{date:Date;kind:Kind}
const dayKey=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const dateText=(d:Date)=>d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})
const memberName=(m:Member)=>m.user?.first_name||m.user?.username||'Участник'
const errorText=(e:unknown)=>e instanceof Error?e.message:'Не удалось выполнить действие. Попробуйте ещё раз.'

export default function CalendarScreen({initialKind,onActionConsumed}:{initialKind?:Kind;onActionConsumed?:()=>void}){
  const actionOpened=useRef(false), mutationLock=useRef(false)
  const [editing,setEditing]=useState<Entry|null>(null),[deleting,setDeleting]=useState<Entry|null>(null),[actionBusy,setActionBusy]=useState(false),[deleteError,setDeleteError]=useState('')
  const [events,setEvents]=useState<Entry[]>([]),[reminders,setReminders]=useState<Entry[]>([]),[members,setMembers]=useState<Member[]>([])
  const [timezone,setTimezone]=useState(DEFAULT_TIMEZONE),[expanded,setExpanded]=useState(false),[filter,setFilter]=useState<'ALL'|Kind>('ALL')
  const initialized=useRef(false)
  const [month,setMonth]=useState(()=>{const p=zoneParts(new Date());return new Date(p.year,p.month-1,1)}),[selectedDay,setSelectedDay]=useState('')
  const [kind,setKind]=useState<Kind>('EVENT'),[show,setShow]=useState(false),[saving,setSaving]=useState(false),[loading,setLoading]=useState(true)
  const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[responsible,setResponsible]=useState<string[]>([]),[when,setWhen]=useState('')
  const [error,setError]=useState(''),[formError,setFormError]=useState(''),[notice,setNotice]=useState('')
  const refresh=async()=>{
    setLoading(true);setError('')
    try{const [e,r,f]=await Promise.all([request('/events'),request('/reminders'),request('/family')]);setEvents(e.data||[]);setReminders(r.data||[]);setMembers(f.data?.members||[]);const zone=f.data?.timezone||DEFAULT_TIMEZONE;setTimezone(zone);if(!initialized.current){const p=zoneParts(new Date(),zone);setMonth(new Date(p.year,p.month-1,1));initialized.current=true}setResponsible(current=>current.length?current:[f.data?.current_member_id||f.data?.members?.[0]?.id].filter(Boolean))}
    catch(e){setError(errorText(e))}finally{setLoading(false)}
  }
  useEffect(()=>{void refresh()},[])
  const open=(value:Kind)=>{
    const input=zoneInput(new Date(Date.now()+3600000),timezone)
    setEditing(null);setKind(value);setTitle('');setDescription('');setWhen(selectedDay?selectedDay+'T'+input.slice(11):input);setFormError('');setShow(true)
  }
  const edit=(item:Entry)=>{
    setEditing(item);setKind('REMINDER');setTitle(item.title);setDescription(item.description||'')
    setWhen(zoneInput(new Date(item.scheduled_at!),timezone));setResponsible(item.responsible_member_ids?.length?item.responsible_member_ids:item.responsible_member?[item.responsible_member.id]:[])
    setFormError('');setShow(true)
  }
  const toggle=async(item:Entry)=>{
    if(mutationLock.current)return
    mutationLock.current=true;setActionBusy(true);setError('')
    try{
      const status=item.status==='COMPLETED'?'SCHEDULED':'COMPLETED'
      const j=await request('/reminders/'+item.id,{status},'PATCH')
      setReminders(rows=>rows.map(x=>x.id===item.id?j.data:x))
      setNotice(status==='COMPLETED'?'Напоминание «'+item.title+'» выполнено.':'Напоминание «'+item.title+'» возвращено в планы.')
    }catch(e){setError(errorText(e))}finally{mutationLock.current=false;setActionBusy(false)}
  }
  const remove=async()=>{
    if(!deleting||mutationLock.current)return
    mutationLock.current=true;setActionBusy(true);setDeleteError('')
    try{
      await request('/reminders/'+deleting.id,undefined,'DELETE')
      setReminders(rows=>rows.filter(x=>x.id!==deleting.id));setNotice('Напоминание «'+deleting.title+'» удалено.');setDeleting(null)
    }catch(e){setDeleteError(errorText(e))}finally{mutationLock.current=false;setActionBusy(false)}
  }
  useEffect(()=>{if(initialKind&&!loading&&!error&&!actionOpened.current&&members.length){actionOpened.current=true;open(initialKind);onActionConsumed?.()}},[initialKind,loading,error,members.length])
  const submit=async(e:FormEvent)=>{
    e.preventDefault();if(saving)return
    if(!responsible.length){setFormError('Выберите хотя бы одного ответственного.');return}
    if(!title.trim()||!when||!Number.isFinite(new Date(when).getTime())){setFormError('Заполните название, дату и время.');return}
    setSaving(true);setFormError('')
    const base={title:title.trim(),description:description.trim()||null,responsible_member_ids:responsible,timezone}
    try{
      const date=wallTimeToDate(when,timezone)
      const j=await request(editing?'/reminders/'+editing.id:kind==='EVENT'?'/events':'/reminders',kind==='EVENT'?{...base,start_at:date.toISOString(),end_at:new Date(date.getTime()+3600000).toISOString(),participant_member_ids:members.map(m=>m.id)}:{...base,scheduled_at:date.toISOString()},editing?'PATCH':'POST')
      if(kind==='EVENT')setEvents(rows=>[...rows,j.data]);else setReminders(rows=>editing?rows.map(x=>x.id===editing.id?j.data:x):[...rows,j.data])
      const p=zoneParts(date,timezone);setMonth(new Date(p.year,p.month-1,1));setSelectedDay(zoneInput(date,timezone).slice(0,10));setFilter(kind);setShow(false);if(!editing)window.dispatchEvent(new Event('family-first-entry-saved'))
      setNotice((kind==='EVENT'?'Встреча':'Напоминание')+' «'+j.data.title+(editing?'» изменено на ':'» добавлено на ')+date.toLocaleDateString('ru-RU',{timeZone:timezone,day:'numeric',month:'long'})+', '+date.toLocaleTimeString('ru-RU',{timeZone:timezone,hour:'2-digit',minute:'2-digit'})+'.')
    }catch(e){setFormError(errorText(e))}finally{setSaving(false)}
  }
  const rows:Row[]=[...events.map(x=>({...x,date:new Date(x.start_at||''),kind:'EVENT' as Kind})),...reminders.map(x=>({...x,date:new Date(x.scheduled_at||''),kind:'REMINDER' as Kind}))].filter(x=>(x.status||'SCHEDULED')==='SCHEDULED'&&Number.isFinite(x.date.getTime())).sort((a,b)=>a.date.getTime()-b.date.getTime())
  const monthRows=rows.filter(x=>{const p=zoneParts(x.date,timezone);return p.month===month.getMonth()+1&&p.year===month.getFullYear()})
  const dayRows=selectedDay?monthRows.filter(x=>zoneInput(x.date,timezone).slice(0,10)===selectedDay):monthRows
  const shown=dayRows.filter(x=>filter==='ALL'||x.kind===filter)
  const completed=reminders.filter(x=>x.status==='COMPLETED'&&x.scheduled_at).map(x=>({...x,date:new Date(x.scheduled_at!),kind:'REMINDER' as Kind})).filter(x=>{
    const p=zoneParts(x.date,timezone);return filter!=='EVENT'&&p.year===month.getFullYear()&&p.month===month.getMonth()+1&&(!selectedDay||zoneInput(x.date,timezone).slice(0,10)===selectedDay)
  }).sort((a,b)=>b.date.getTime()-a.date.getTime())
  const dayCounts=new Map<string,number>();for(const row of rows){const key=zoneInput(row.date,timezone).slice(0,10);dayCounts.set(key,(dayCounts.get(key)||0)+1)}
  const offset=(month.getDay()+6)%7,days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate(),today=zoneInput(new Date(),timezone).slice(0,10)
  const anchor=selectedDay||(today.startsWith(`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}`)?today:dayKey(month))
  const anchorDate=new Date(anchor+'T12:00:00'),weekStart=new Date(anchorDate);weekStart.setDate(anchorDate.getDate()-(anchorDate.getDay()+6)%7)
  const calendarDays=expanded?Array.from({length:days},(_,i)=>new Date(month.getFullYear(),month.getMonth(),i+1)):Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(d.getDate()+i);return d})
  const moveMonth=(delta:number)=>{setMonth(d=>new Date(d.getFullYear(),d.getMonth()+delta,1));setSelectedDay('')}
  const renderEntry=(x:Row)=>(<article className={'c-entry'+(x.status==='COMPLETED'?' c-completed-entry':'')} key={x.kind+x.id}>
        {x.kind==='REMINDER'&&<input className="c-reminder-check" type="checkbox" aria-label={(x.status==='COMPLETED'?'Вернуть в планы: ':'Выполнено: ')+x.title} checked={x.status==='COMPLETED'} disabled={!x.can_complete||actionBusy||loading} onChange={()=>void toggle(x)}/>}
        <div className="c-date"><b>{zoneParts(x.date,timezone).day}</b><small>{x.date.toLocaleDateString('ru-RU',{timeZone:timezone,month:'short'})}</small></div>
        <div className="c-copy"><span className="c-kind">{x.kind==='EVENT'?'Встреча':'Напоминание'}</span><strong>{x.title}</strong>{x.kind==='REMINDER'&&x.status!=='COMPLETED'&&x.date.getTime()<Date.now()&&<small className="c-overdue">Просрочено</small>}{x.description&&<details className="c-description"><summary>Описание</summary><p>{x.description}</p></details>}<small>{x.responsible_member_ids?.length?'Ответственные: '+x.responsible_member_ids.map(id=>{const member=members.find(m=>m.id===id);return member?memberName(member):'Бывший участник'}).join(', '):x.responsible_member?'Ответственный: '+memberName(x.responsible_member):x.creator?'Добавил(а): '+(x.creator.first_name||x.creator.username||'участник'):''}</small></div>
        <div className="c-entry-end"><time dateTime={x.date.toISOString()}>{x.date.toLocaleTimeString('ru-RU',{timeZone:timezone,hour:'2-digit',minute:'2-digit'})}</time>{x.kind==='REMINDER'&&x.can_edit&&<div className="c-entry-actions"><button className="c-icon" aria-label={'Изменить напоминание: '+x.title} disabled={actionBusy||loading} onClick={()=>edit(x)}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7l-4-4L5 15z"/></svg></button><button className="c-icon" aria-label={'Удалить напоминание: '+x.title} disabled={actionBusy||loading} onClick={()=>{setDeleting(x);setDeleteError('')}}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></div>}</div>
      </article>)
  return <div className="calendar-page">
    <div className="section-title"><h2>Календарь</h2><button className="c-icon" aria-label="Обновить календарь" onClick={()=>void refresh()} disabled={loading||actionBusy||saving}>↻</button></div>
    {error&&<div className="c-message c-error" role="alert">{error}</div>}
    {notice&&<div className="c-message" role="status">{notice}<button className="c-icon" aria-label="Закрыть уведомление" onClick={()=>setNotice('')}>×</button></div>}
    <section className="card c-month" aria-label="Календарь месяца">
      <div className="c-month-head"><button className="c-icon" aria-label="Предыдущий месяц" onClick={()=>moveMonth(-1)}>‹</button><h3 aria-live="polite">{month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</h3><button className="c-icon" aria-label="Следующий месяц" onClick={()=>moveMonth(1)}>›</button><button className="c-today" onClick={()=>{const p=zoneParts(new Date(),timezone);setMonth(new Date(p.year,p.month-1,1));setSelectedDay(today)}}>Сегодня</button></div>
      <div className="c-weekdays" aria-hidden="true">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=><span key={d}>{d}</span>)}</div>
      <div className="c-grid" role="group" aria-label="Выбор даты">{expanded&&Array.from({length:offset},(_,i)=><span key={'empty'+i}/>)}{calendarDays.map(d=>{
        const key=dayKey(d),count=dayCounts.get(key)||0
        return <button className="c-day" key={key} aria-label={`${dateText(d)} ${d.getFullYear()}, планов: ${count}`} aria-pressed={selectedDay===key} aria-current={key===today?'date':undefined} onClick={()=>{setMonth(new Date(d.getFullYear(),d.getMonth(),1));setSelectedDay(selected=>selected===key?'':key)}}><span>{d.getDate()}</span><small aria-hidden="true">{count>0?(count>1?count:'•'):'\u00a0'}</small></button>
      })}</div>
      <div className="c-month-footer"><button className="c-link" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'Свернуть месяц':'Показать месяц'}</button><span>Планов: {monthRows.length}</span>{selectedDay&&<button className="c-link" onClick={()=>setSelectedDay('')}>Весь месяц</button>}</div>
      <div className="c-create-actions"><button className="button primary" onClick={()=>open('EVENT')} disabled={loading||!members.length}>＋ Встреча</button><button className="button secondary" onClick={()=>open('REMINDER')} disabled={loading||!members.length}>＋ Напоминание</button></div>
    </section>
    <div className="c-filters" role="tablist" aria-label="Виды планов">{([['ALL','Все'],['EVENT','Встречи'],['REMINDER','Напоминания']] as const).map(([value,label])=><button key={value} role="tab" aria-selected={filter===value} onClick={()=>setFilter(value)}>{label} <small>{dayRows.filter(x=>value==='ALL'||x.kind===value).length}</small></button>)}</div>
    <section className="card c-agenda" aria-label="События и напоминания">
      <div className="c-head"><h3>{selectedDay?'Планы на '+dateText(new Date(selectedDay+'T12:00:00')):'Планы на месяц'} <span className="c-count">{shown.length}</span></h3><Help label="О календаре" text={'Время календаря: '+timezoneLabel(timezone)+'. Меняется в разделе «Семья». Встреча создаётся на один час. Выберите день или тип плана.'}/></div>
      {loading&&<p className="c-empty" role="status">Загружаем планы…</p>}
      {!loading&&!error&&!shown.length&&<p className="c-empty">{selectedDay?'На этот день планов пока нет.':'В этом месяце планов пока нет.'}</p>}
      {shown.map(renderEntry)}
      {completed.length>0&&<details className="c-completed"><summary>Выполнено · {completed.length}</summary>{completed.map(renderEntry)}</details>}
    </section>
    {deleting&&<Modal title="Удалить напоминание?" onClose={()=>setDeleting(null)} busy={actionBusy}><p className="c-delete-copy">«{deleting.title}» будет удалено у всех участников семьи. Восстановить его не получится.</p>{deleteError&&<div className="c-message c-error" role="alert">{deleteError}</div>}<div className="f-actions"><button className="button secondary" disabled={actionBusy} onClick={()=>setDeleting(null)}>Отмена</button><button className="button danger" disabled={actionBusy} onClick={()=>void remove()}>{actionBusy?'Удаляем…':'Удалить'}</button></div></Modal>}
    {show&&<Modal title={editing?'Изменить напоминание':kind==='EVENT'?'Новая встреча':'Новое напоминание'} onClose={()=>setShow(false)} busy={saving}><form className="f-form" onSubmit={submit}>
      <div className="f-form-fields">
        <Field label="Название"><input required maxLength={255} value={title} onChange={e=>setTitle(e.target.value)} placeholder={kind==='EVENT'?'Например, Встреча':'Например, Забрать заказ'} disabled={saving}/></Field>
        <Field label="Дата"><input type="date" required value={when.slice(0,10)} onChange={e=>setWhen(e.target.value+'T'+(when.slice(11,16)||'09:00'))} disabled={saving}/></Field>
        <Field label="Время"><input type="time" required value={when.slice(11,16)} onChange={e=>setWhen(when.slice(0,10)+'T'+e.target.value)} disabled={saving}/></Field>
        <div className="c-zone"><span>Часовой пояс</span><strong>{timezoneLabel(timezone)}</strong></div>
        <fieldset className="c-responsibles" disabled={saving}><legend>Ответственные <span>{responsible.length}</span></legend><div>{members.map(m=><label key={m.id}><input type="checkbox" checked={responsible.includes(m.id)} onChange={e=>setResponsible(ids=>e.target.checked?[...ids,m.id]:ids.filter(id=>id!==m.id))}/><span>{memberName(m)}</span></label>)}</div></fieldset>
        <Field label="Описание"><textarea maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Необязательно" disabled={saving}/></Field>
      </div>
      {formError&&<div className="c-message c-error" role="alert">{formError}</div>}
      <div className="f-actions"><button type="button" className="button secondary" disabled={saving} onClick={()=>setShow(false)}>Отмена</button><button className="button primary" disabled={saving}>{saving?'Сохраняем…':'Сохранить'}</button></div>
    </form></Modal>}
  </div>
}
