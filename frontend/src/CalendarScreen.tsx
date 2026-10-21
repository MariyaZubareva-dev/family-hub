import { useEffect, useState, type FormEvent } from 'react'
import { Field, Help, Modal } from './FinanceScreen'
import './calendar.css'

type Kind='EVENT'|'REMINDER'
type Member={id:string;user?:{first_name?:string;username?:string}}
type Entry={id:string;title:string;description?:string;status:string;start_at?:string;scheduled_at?:string;responsible_member?:Member;creator?:{first_name?:string;username?:string}}
type Row=Entry&{date:Date;kind:Kind}
const dayKey=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const dateText=(d:Date)=>d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})
const localInput=(d:Date)=>`${dayKey(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
const memberName=(m:Member)=>m.user?.first_name||m.user?.username||'Участник'
const errorText=(e:unknown)=>e instanceof Error?e.message:'Не удалось выполнить действие. Попробуйте ещё раз.'
async function request(path:string,body?:unknown){
  const headers:Record<string,string>={Accept:'application/json','Content-Type':'application/json'}
  const initData=(window as any).Telegram?.WebApp?.initData
  if(initData)headers['X-Telegram-Init-Data']=initData
  else headers['X-Dev-Telegram-User-Id']=localStorage.getItem('dev_telegram_id')||'999001'
  let response:Response
  try{response=await fetch('/api/v1'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)})}
  catch{throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.')}
  const json=await response.json().catch(()=>null)
  if(!response.ok){
    if(response.status===401)throw new Error('Откройте приложение заново через Telegram.')
    if(response.status===403)throw new Error('Нет доступа к календарю этой семьи. Обратитесь к администратору.')
    if(response.status>=500)throw new Error('Сервер временно недоступен. Попробуйте ещё раз позже.')
    const message=Object.values(json?.errors||{}).flat()[0]||json?.message
    if(typeof message==='string'&&/[а-яё]/i.test(message)&&!/SQLSTATE|Exception|<|>/.test(message))throw new Error(message)
    throw new Error(response.status===422?'Проверьте название, дату и ответственного. Данные пока не сохранены.':'Не удалось выполнить действие. Попробуйте ещё раз.')
  }
  return json
}

export default function CalendarScreen(){
  const [events,setEvents]=useState<Entry[]>([]),[reminders,setReminders]=useState<Entry[]>([]),[members,setMembers]=useState<Member[]>([])
  const [month,setMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1)),[selectedDay,setSelectedDay]=useState('')
  const [kind,setKind]=useState<Kind>('EVENT'),[show,setShow]=useState(false),[saving,setSaving]=useState(false),[loading,setLoading]=useState(true)
  const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[responsible,setResponsible]=useState(''),[when,setWhen]=useState('')
  const [error,setError]=useState(''),[formError,setFormError]=useState(''),[notice,setNotice]=useState('')
  const refresh=async()=>{
    setLoading(true);setError('')
    try{const [e,r,f]=await Promise.all([request('/events'),request('/reminders'),request('/family')]);setEvents(e.data||[]);setReminders(r.data||[]);setMembers(f.data?.members||[]);setResponsible(current=>current||f.data?.current_member_id||f.data?.members?.[0]?.id||'')}
    catch(e){setError(errorText(e))}finally{setLoading(false)}
  }
  useEffect(()=>{void refresh()},[])
  const open=(value:Kind)=>{
    const next=new Date(Date.now()+3600000)
    if(selectedDay){const [y,m,d]=selectedDay.split('-').map(Number);next.setFullYear(y,m-1,d)}
    setKind(value);setTitle('');setDescription('');setWhen(localInput(next));setFormError('');setShow(true)
  }
  const submit=async(e:FormEvent)=>{
    e.preventDefault();if(saving)return
    if(!title.trim()||!responsible||!when||!Number.isFinite(new Date(when).getTime())){setFormError('Заполните название, дату и ответственного.');return}
    setSaving(true);setFormError('')
    const date=new Date(when),timezone=Intl.DateTimeFormat().resolvedOptions().timeZone
    const base={title:title.trim(),description:description.trim()||undefined,responsible_member_id:responsible,timezone}
    try{
      const j=await request(kind==='EVENT'?'/events':'/reminders',kind==='EVENT'?{...base,start_at:date.toISOString(),end_at:new Date(date.getTime()+3600000).toISOString(),participant_member_ids:members.map(m=>m.id)}:{...base,scheduled_at:date.toISOString()})
      if(kind==='EVENT')setEvents(rows=>[...rows,j.data]);else setReminders(rows=>[...rows,j.data])
      setMonth(new Date(date.getFullYear(),date.getMonth(),1));setSelectedDay(dayKey(date));setShow(false)
      setNotice((kind==='EVENT'?'Событие':'Напоминание')+' «'+j.data.title+'» добавлено на '+dateText(date)+', '+date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+'.')
    }catch(e){setFormError(errorText(e))}finally{setSaving(false)}
  }
  const rows:Row[]=[...events.map(x=>({...x,date:new Date(x.start_at||''),kind:'EVENT' as Kind})),...reminders.map(x=>({...x,date:new Date(x.scheduled_at||''),kind:'REMINDER' as Kind}))].filter(x=>x.status==='SCHEDULED'&&Number.isFinite(x.date.getTime())).sort((a,b)=>a.date.getTime()-b.date.getTime())
  const monthRows=rows.filter(x=>x.date.getMonth()===month.getMonth()&&x.date.getFullYear()===month.getFullYear())
  const shown=selectedDay?monthRows.filter(x=>dayKey(x.date)===selectedDay):monthRows
  const dayCounts=new Map<string,number>();for(const row of monthRows){const key=dayKey(row.date);dayCounts.set(key,(dayCounts.get(key)||0)+1)}
  const offset=(month.getDay()+6)%7,days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate(),today=dayKey(new Date())
  const moveMonth=(delta:number)=>{setMonth(d=>new Date(d.getFullYear(),d.getMonth()+delta,1));setSelectedDay('')}
  return <div className="calendar-page">
    <div className="section-title"><h2>Календарь</h2><button className="c-icon" aria-label="Обновить календарь" onClick={()=>void refresh()} disabled={loading}>↻</button></div>
    {error&&<div className="c-message c-error" role="alert">{error}</div>}
    {notice&&<div className="c-message" role="status">{notice}<button className="c-icon" aria-label="Закрыть уведомление" onClick={()=>setNotice('')}>×</button></div>}
    <section className="card c-month" aria-label="Календарь месяца">
      <div className="c-month-head"><button className="c-icon" aria-label="Предыдущий месяц" onClick={()=>moveMonth(-1)}>‹</button><h3 aria-live="polite">{month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</h3><button className="c-icon" aria-label="Следующий месяц" onClick={()=>moveMonth(1)}>›</button><button className="c-today" onClick={()=>{const d=new Date();setMonth(new Date(d.getFullYear(),d.getMonth(),1));setSelectedDay(dayKey(d))}}>Сегодня</button></div>
      <div className="c-weekdays" aria-hidden="true">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=><span key={d}>{d}</span>)}</div>
      <div className="c-grid" role="group" aria-label="Выбор даты">{Array.from({length:offset},(_,i)=><span key={'empty'+i}/>)}{Array.from({length:days},(_,i)=>{
        const d=new Date(month.getFullYear(),month.getMonth(),i+1),key=dayKey(d),count=dayCounts.get(key)||0
        return <button className="c-day" key={key} aria-label={`${dateText(d)} ${d.getFullYear()}, планов: ${count}`} aria-pressed={selectedDay===key} aria-current={key===today?'date':undefined} onClick={()=>setSelectedDay(selected=>selected===key?'':key)}><span>{i+1}</span><small aria-hidden="true">{count>0?(count>1?count:'•'):'\u00a0'}</small></button>
      })}</div>
      <div className="c-month-footer"><span>Планов на месяц: {monthRows.length}</span>{selectedDay&&<button className="c-link" onClick={()=>setSelectedDay('')}>Весь месяц</button>}</div>
      <div className="c-create-actions"><button className="button primary" onClick={()=>open('EVENT')} disabled={loading||!members.length}>＋ Событие</button><button className="button secondary" onClick={()=>open('REMINDER')} disabled={loading||!members.length}>＋ Напоминание</button></div>
    </section>
    <section className="card c-agenda" aria-label="События и напоминания">
      <div className="c-head"><h3>{selectedDay?'Планы на '+dateText(new Date(selectedDay+'T12:00:00')):'Планы на месяц'} <span className="c-count">{shown.length}</span></h3><Help label="О календаре" text="События и напоминания видны участникам с доступом к календарю. Событие создаётся на один час. Выберите день, чтобы посмотреть его планы."/></div>
      {loading&&<p className="c-empty" role="status">Загружаем планы…</p>}
      {!loading&&!error&&!shown.length&&<p className="c-empty">{selectedDay?'На этот день планов пока нет.':'В этом месяце планов пока нет.'}</p>}
      {shown.map(x=><article className="c-entry" key={x.kind+x.id}>
        <div className="c-date"><b>{x.date.getDate()}</b><small>{x.date.toLocaleDateString('ru-RU',{month:'short'})}</small></div>
        <div className="c-copy"><span className="c-kind">{x.kind==='EVENT'?'Событие':'Напоминание'}</span><strong>{x.title}</strong>{x.description&&<details className="c-description"><summary>Описание</summary><p>{x.description}</p></details>}<small>{x.responsible_member?'Ответственный: '+memberName(x.responsible_member):x.creator?'Добавил(а): '+(x.creator.first_name||x.creator.username||'участник'):''}</small></div>
        <time dateTime={x.date.toISOString()}>{x.date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time>
      </article>)}
    </section>
    {show&&<Modal title={kind==='EVENT'?'Новое событие':'Новое напоминание'} onClose={()=>setShow(false)} busy={saving}><form className="f-form" onSubmit={submit}>
      <div className="f-form-fields">
        <Field label="Название"><input required maxLength={255} value={title} onChange={e=>setTitle(e.target.value)} placeholder={kind==='EVENT'?'Например, Встреча':'Например, Забрать заказ'} disabled={saving}/></Field>
        <Field label="Дата"><input type="date" required value={when.slice(0,10)} onChange={e=>setWhen(e.target.value+'T'+(when.slice(11,16)||'09:00'))} disabled={saving}/></Field>
        <Field label="Время"><input type="time" required value={when.slice(11,16)} onChange={e=>setWhen(when.slice(0,10)+'T'+e.target.value)} disabled={saving}/></Field>
        <Field label="Ответственный"><select value={responsible} required onChange={e=>setResponsible(e.target.value)} disabled={saving}>{members.map(m=><option key={m.id} value={m.id}>{memberName(m)}</option>)}</select></Field>
        <Field label="Описание"><textarea maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Необязательно" disabled={saving}/></Field>
      </div>
      {formError&&<div className="c-message c-error" role="alert">{formError}</div>}
      <div className="f-actions"><button type="button" className="button secondary" disabled={saving} onClick={()=>setShow(false)}>Отмена</button><button className="button primary" disabled={saving}>{saving?'Сохраняем…':'Сохранить'}</button></div>
    </form></Modal>}
  </div>
}
