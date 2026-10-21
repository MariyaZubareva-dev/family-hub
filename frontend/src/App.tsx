import { useEffect, useMemo, useState } from 'react'
import './styles.v07.css'
import './family.css'
import FinanceScreen from './FinanceScreen'
import ShoppingScreen from './ShoppingScreen'

function FamilySymbol({kind}:{kind:string}) {
  const paths:Record<string,string>={
    home:'m3 10 9-7 9 7 M5 9v12h14V9 M9 21v-8h6v8',
    calendar:'M5 5h14v16H5z M8 3v4 M16 3v4 M5 10h14 M8 14h2 M14 14h2 M8 17h2',
    shopping:'M9 6h11 M9 12h11 M9 18h11 m-17-12 1 1 2-2 m-3 7 1 1 2-2 m-3 7 1 1 2-2',
    finance:'M3 6h18v14H3z M3 10h18 M15 15h3 M6 3h12',
    edit:'m4 16 12-12 4 4-12 12-5 1z M13 7l4 4',
    settings:'M8 3h8v4l3 2 3 2-4 7-3-1-3 2-3-2-3 1-4-7 3-2 3-2z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  }
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]||paths.home}/></svg>
}

// ---- API helpers (Telegram auth + local dev fallback) ----
function getAuthHeaders(): Record<string,string> {
  const h: Record<string,string> = { 'Content-Type': 'application/json', 'Accept': 'application/json' }
  const tg = (window as any).Telegram?.WebApp
  if (tg?.initData) h['X-Telegram-Init-Data'] = tg.initData
  else {
    const devId = (typeof localStorage !== 'undefined' && localStorage.getItem('dev_telegram_id')) || '999001'
    h['X-Dev-Telegram-User-Id'] = devId
  }
  return h
}
async function apiError(response:Response):Promise<Error>{
  const fallback=response.status===401?'Откройте Family Hub заново через Telegram.':response.status===403?'Этот раздел доступен после вступления в семью. Откройте раздел «Семья» и примите приглашение.':`Не удалось выполнить запрос (${response.status}). Попробуйте ещё раз.`
  const body=await response.text()
  try{
    const data=JSON.parse(body)
    const message=Object.values(data.errors||{}).flat()[0]||data.message
    if(message==='Active family membership required.')return new Error(fallback)
    if(typeof message==='string'&&message&&!/[<>]/.test(message))return new Error(message)
  }catch{}
  return new Error(fallback)
}
async function apiGet(path:string){
  const r = await fetch(`/api/v1${path}`, { headers: getAuthHeaders() })
  if(!r.ok) throw await apiError(r)
  return r.json()
}
async function apiPost(path:string, body:any){
  const r = await fetch(`/api/v1${path}`, { method:'POST', headers: getAuthHeaders(), body: JSON.stringify(body) })
  if(!r.ok) throw await apiError(r)
  return r.json()
}
async function apiPatch(path:string, body:any){
  const r = await fetch(`/api/v1${path}`, { method:'PATCH', headers: getAuthHeaders(), body: JSON.stringify(body) })
  if(!r.ok) throw await apiError(r)
  return r.json()
}
function toBase64(file:File):Promise<string>{
  return new Promise((res,rej)=>{
    const fr=new FileReader()
    fr.onload=()=>res(fr.result as string)
    fr.onerror=rej
    fr.readAsDataURL(file)
  })
}

// ---- MOCK DATA from screenshot ----
type Cat = { id:string; name:string; icon:string; color:string; amount:number; budget?:number; income?:boolean }
const CATS: Cat[] = [
  { id:'products', name:'Продукты', icon:'🥫', color:'#EF4444', amount:57357, budget:20000 },
  { id:'eating_out', name:'Еда вне дома', icon:'🥤', color:'#F97316', amount:4587, budget:5000 },
  { id:'transport', name:'Транспорт', icon:'🚃', color:'#9CA3AF', amount:0, budget:4000 },
  { id:'shopping', name:'Покупки', icon:'🛍️', color:'#EF4444', amount:40235, budget:40000 },
  { id:'entertain', name:'Развлечения', icon:'🎬', color:'#22C55E', amount:1348 },
  { id:'health', name:'Здоровье', icon:'➕', color:'#22C55E', amount:13083 },
  { id:'services', name:'Услуги', icon:'📰', color:'#22C55E', amount:2500 },
  { id:'home', name:'Дом. хоз-во', icon:'🏠', color:'#22C55E', amount:7673 },
  { id:'gifts', name:'Подарки', icon:'🎁', color:'#9CA3AF', amount:4857, budget:20000 },
  { id:'credit', name:'Кредит', icon:'🧮', color:'#9CA3AF', amount:0, budget:5400 },
  { id:'commission', name:'Комиссия', icon:'%', color:'#22C55E', amount:0 },
  { id:'rent', name:'Квартира', icon:'🏠', color:'#22C55E', amount:0 },
  { id:'travel', name:'Путешествия', icon:'✈️', color:'#22C55E', amount:0 },
  { id:'clothes', name:'Одежда', icon:'👗', color:'#22C55E', amount:809 },
  { id:'sites', name:'Сайты', icon:'📰', color:'#22C55E', amount:3000 },
  { id:'invest', name:'Инвестиции', icon:'📈', color:'#22C55E', amount:0 },
  { id:'crypto', name:'Крипта', icon:'🌐', color:'#22C55E', amount:0 },
  { id:'edu', name:'Образование', icon:'🎓', color:'#22C55E', amount:0 },
  { id:'auto', name:'Автомобиль', icon:'🚗', color:'#22C55E', amount:5998 },
  { id:'maria', name:'Мария', icon:'🪴', color:'#22C55E', amount:18200 },
]
const INCOMES: Cat[] = [
  { id:'income', name:'Доход', icon:'💰', color:'#0EA5E9', amount:651, income:true },
  { id:'work', name:'РАбота', icon:'🏢', color:'#0EA5E9', amount:173571, income:true },
  { id:'cashback', name:'Кеш бек', icon:'◐', color:'#0EA5E9', amount:2913, income:true },
  { id:'invest_i', name:'Инвестиции', icon:'◎', color:'#0EA5E9', amount:26500, income:true },
]

const pluralRu=(n:number,one:string,few:string,many:string)=>n%100>=11&&n%100<=14?many:n%10===1?one:n%10>=2&&n%10<=4?few:many
const rub = (v:number)=> `${v.toLocaleString('ru-RU')} ₽`
const shortRub = (v:number)=> v>=1000? `${(v/1000).toFixed(v>=10000?0:1)}k ₽` : `${v} ₽`

type Section = 'home'|'calendar'|'lists'|'finance'|'family'
type VisibilitySection = 'calendar'|'shopping'|'finance'
type SectionVisibility = Record<VisibilitySection,boolean>
const ALL_VISIBLE:SectionVisibility={calendar:true,shopping:true,finance:true}
const SHARED_SECTIONS:{id:VisibilitySection;title:string;icon:string}[]=[{id:'calendar',title:'Календарь и напоминания',icon:'▦'},{id:'shopping',title:'Покупки и списки',icon:'☷'},{id:'finance',title:'Бюджет и кредиты',icon:'₽'}]
const canOpenSection=(section:Section,v:SectionVisibility)=>section==='calendar'?v.calendar:section==='lists'?v.shopping:section==='finance'?v.finance:true
type FinanceTab = 'overview'|'categories'|'receipts'|'stocks'|'large'|'credits'|'budget'

export default function App(){
  const [section,setSection]=useState<Section>(()=>{const target=new URLSearchParams(window.location.search).get('section');return ['home','calendar','lists','finance','family'].includes(target||'')?target as Section:'home'})
  const [fTab,setFTab]=useState<FinanceTab>('overview')
  const [selectedCat,setSelectedCat]=useState<string|null>(null)
  const [receiptItems,setReceiptItems]=useState<any[]>([])
  const [showReceiptConfirm,setShowReceiptConfirm]=useState(false)
  const [monthlyPlan,setMonthlyPlan]=useState(10000)
  const [access,setAccess]=useState<SectionVisibility|null>(null)
  const [familyRole,setFamilyRole]=useState('')
  const [accessError,setAccessError]=useState('')
  useEffect(()=>{
    let active=true
    const refreshAccess=()=>apiGet('/me').then(result=>{
      if(!active)return
      setFamilyRole(result.data?.family?.role||'')
      const v={...ALL_VISIBLE,...result.data?.family?.visibility}
      setAccess(result.data?.family?v:{calendar:false,shopping:false,finance:false})
      setAccessError('')
      setSection(current=>!result.data?.family?'family':canOpenSection(current,v)?current:'family')
    }).catch((e:any)=>{if(active)setAccessError(String(e.message||e))})
    refreshAccess()
    const onVisible=()=>{if(document.visibilityState==='visible')refreshAccess()}
    window.addEventListener('focus',onVisible)
    window.addEventListener('family-access-changed',refreshAccess)
    document.addEventListener('visibilitychange',onVisible)
    return ()=>{active=false;window.removeEventListener('focus',onVisible);window.removeEventListener('family-access-changed',refreshAccess);document.removeEventListener('visibilitychange',onVisible)}
  },[])


  const totalExpense = useMemo(()=> CATS.reduce((s,c)=>s+c.amount,0),[])
  const sortedAll = useMemo(()=> [...CATS].filter(c=>c.amount>0).sort((a,b)=>b.amount-a.amount),[])
  const ranked = sortedAll
  const donutTop5 = sortedAll.slice(0,5)
  const donutOtherAmount = totalExpense - donutTop5.reduce((s,c)=>s+c.amount,0)
  const donutData: Cat[] = (donutTop5.length===5 && donutOtherAmount>0) ? [...donutTop5, {id:'other', name:`Остальные ${sortedAll.length-5}`, icon:'•', color:'#9CA3AF', amount: donutOtherAmount}] : donutTop5

  return <div className="app-shell">
    {/* TOPBAR */}
    <header className="topbar">
      <h1>Family Hub</h1>
    </header>

    <main className="page">
      {accessError&&<div className="family-alert" role="alert">{accessError}</div>}
      {!access&&!accessError&&<div className="family-loading">Загружаем пространство…</div>}
      {access&&section==='home' && <HomeView onGo={setSection} totalExpense={totalExpense} visibility={access} />}
      {access?.calendar&&section==='calendar' && <CalendarV07 />}
      {access?.shopping&&section==='lists' && <ShoppingScreen isAdmin={familyRole==='ADMIN'} />}
      {access?.finance&&section==='finance' && <FinanceScreen />}
      {access&&section==='family' && <FamilyV07 />}
    </main>

    <nav className="bottom-nav" aria-label="Основная навигация" style={{gridTemplateColumns:`repeat(${2+Number(!!access?.calendar)+Number(!!access?.shopping)+Number(!!access?.finance)},minmax(0,1fr))`}}>
      <Nav active={section==='home'} label="Главная" icon="⌂" onClick={()=>setSection('home')} />
      {access?.calendar&&<Nav active={section==='calendar'} label="Календарь" icon="▦" onClick={()=>setSection('calendar')} />}
      {access?.shopping&&<Nav active={section==='lists'} label="Покупки" icon="☷" onClick={()=>setSection('lists')} />}
      {access?.finance&&<Nav active={section==='finance'} label="Финансы" icon="₽" onClick={()=>setSection('finance')} />}
      <Nav active={section==='family'} label="Семья" icon="👨‍👩‍👧" onClick={()=>setSection('family')} />
    </nav>
  </div>
}

function Nav(p:{active:boolean; label:string; icon:string; onClick:()=>void}){
  return <button className={p.active?'nav-item active':'nav-item'} onClick={p.onClick}>
    <span style={{fontSize:18}}>{p.icon}</span><small>{p.label}</small>
  </button>
}

// ---------- HOME — dashboard спека ----------
function HomeView(p:{onGo:(s:Section)=>void; totalExpense:number;visibility:SectionVisibility}){
  const [events,setEvents]=useState<any[]>([]);const [reminders,setReminders]=useState<any[]>([]);const [credits,setCredits]=useState<any[]>([]);const [analytics,setAnalytics]=useState<any>(null)
  useEffect(()=>{const n=new Date();const q=`?period=month&year=${n.getFullYear()}&month=${n.getMonth()+1}`;Promise.allSettled([p.visibility.calendar?apiGet('/events'):Promise.resolve({data:[]}),p.visibility.calendar?apiGet('/reminders'):Promise.resolve({data:[]}),p.visibility.finance?apiGet('/credits'):Promise.resolve({data:[]}),p.visibility.finance?apiGet('/finance/analytics'+q):Promise.resolve({data:null})]).then(r=>{if(r[0].status==='fulfilled')setEvents(r[0].value.data||[]);if(r[1].status==='fulfilled')setReminders(r[1].value.data||[]);if(r[2].status==='fulfilled')setCredits(r[2].value.data||[]);if(r[3].status==='fulfilled')setAnalytics(r[3].value.data)})},[p.visibility.calendar,p.visibility.finance])
  const soon=[...events.filter(x=>x.status==='SCHEDULED').map(x=>({...x,_at:new Date(x.start_at),_kind:'Событие'})),...reminders.filter(x=>x.status==='SCHEDULED').map(x=>({...x,_at:new Date(x.scheduled_at),_kind:'Напоминание'}))].filter(x=>x._at>=new Date()).sort((a,b)=>a._at-b._at).slice(0,5)
  const cats=(analytics?.ranked||[]).slice(0,6);const max=Math.max(1,...cats.map((c:any)=>Number(c.amount)||0))
  const next=credits.map(c=>{const [y,m,day]=String(c.first_payment_date).slice(0,10).split('-').map(Number);const first=new Date(y,m-1,day);const today=new Date();today.setHours(0,0,0,0);const addMonth=(n:number)=>{const ix=first.getFullYear()*12+first.getMonth()+n;const yr=Math.floor(ix/12);const mo=ix%12;return new Date(yr,mo,Math.min(first.getDate(),new Date(yr,mo+1,0).getDate()))};let idx=Math.max(0,(today.getFullYear()-first.getFullYear())*12+today.getMonth()-first.getMonth());let d=addMonth(idx);if(d<today){idx++;d=addMonth(idx)}const installment=idx+1;const part=(c.payment_schedule||[]).find((x:any)=>installment>=Number(x.from_month)&&installment<=Number(x.to_month));return {...c,_next:d,_nextAmount:Number(part?.amount??c.standard_payment)}}).sort((a,b)=>a._next-b._next).slice(0,4)
  return <div className="stack"><SectionTitle title="Обзор семьи" subtitle={new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})} />
    <div className="grid-2">{p.visibility.calendar&&<div className="card"><div className="card-head"><h3>События и напоминания</h3><button className="button secondary small" onClick={()=>p.onGo('calendar')}>Календарь →</button></div>{soon.length?soon.map((x:any)=><div className="list-item-card" key={x._kind+x.id}><span className="pill">{x._kind}</span><strong style={{flex:1}}>{x.title}</strong><small>{x._at.toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</small></div>):<p className="muted">Ближайших событий и напоминаний нет.</p>}<button className="button primary small" onClick={()=>p.onGo('calendar')}>＋ Добавить</button></div>}
      {p.visibility.finance&&<div className="card"><div className="card-head"><h3>Бюджет за месяц</h3><button className="button secondary small" onClick={()=>p.onGo('finance')}>Финансы →</button></div><div className="grid-3"><div className="metric"><small>Доходы</small><strong>{rub(Number(analytics?.total_income)||0)}</strong></div><div className="metric"><small>Расходы</small><strong>{rub(Number(analytics?.total_expense)||0)}</strong></div><div className="metric balance"><small>Остаток</small><strong style={{color:(Number(analytics?.balance)||0)>=0?'#0F766E':'#E11D48'}}>{rub(Number(analytics?.balance)||0)}</strong></div></div>{cats.length?cats.map((c:any)=><div key={c.id||c.name} style={{marginTop:8}}><div className="summary-line"><span>{c.name}</span><b>{rub(Number(c.amount)||0)}</b></div><div className="progress"><span style={{width:`${Math.max(2,Number(c.amount)/max*100)}%`,background:c.color||'#0F766E'}} /></div></div>):<p className="muted">Расходы появятся после добавления операций.</p>}</div>}</div>
    {p.visibility.finance&&<div className="card"><div className="card-head"><h3>Ближайшие платежи по кредитам</h3><button className="button secondary small" onClick={()=>{p.onGo('finance')}}>Кредиты →</button></div>{next.length?next.map((c:any)=><div className="list-item-card" key={c.id}><strong style={{flex:1}}>{c.name||'Кредит'}</strong><span>{c._next.toLocaleDateString('ru-RU')}</span><b>{rub(Number(c._nextAmount)||0)}</b></div>):<p className="muted">Кредиты не добавлены.</p>}</div>}
    {!p.visibility.calendar&&!p.visibility.finance&&<div className="card"><p className="muted">Доступные разделы указаны в нижнем меню. Настройки видимости — в разделе «Семья».</p><button className="button secondary small" onClick={()=>p.onGo('family')}>Открыть семью</button></div>}
  </div>
}

// ---- CALENDAR ----
function CalendarV07(){
  const [events,setEvents]=useState<any[]>([]);const [reminders,setReminders]=useState<any[]>([]);const [members,setMembers]=useState<any[]>([]);const [kind,setKind]=useState<'EVENT'|'REMINDER'>('EVENT');const [show,setShow]=useState(false);const [saving,setSaving]=useState(false);const [error,setError]=useState('');const [title,setTitle]=useState('');const [description,setDescription]=useState('');const [responsible,setResponsible]=useState('');const [month,setMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));const [selectedDay,setSelectedDay]=useState('');const [when,setWhen]=useState(()=>{const d=new Date(Date.now()+3600000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)})
  const refresh=()=>Promise.all([apiGet('/events'),apiGet('/reminders'),apiGet('/family')]).then(([e,r,f])=>{setEvents(e.data||[]);setReminders(r.data||[]);const ms=f.data?.members||[];setMembers(ms);setResponsible(current=>current||ms[0]?.id||'')}).catch(e=>setError(String(e.message||e).slice(0,130)))
  useEffect(()=>{refresh()},[])
  const submit=async()=>{if(!title.trim()||!responsible){setError('Заполните название и выберите ответственного.');return}setSaving(true);setError('');try{const d=new Date(when);if(kind==='EVENT')await apiPost('/events',{title,description:description||undefined,start_at:d.toISOString(),end_at:new Date(d.getTime()+3600000).toISOString(),timezone:'Europe/Moscow',responsible_member_id:responsible,participant_member_ids:members.map(m=>m.id)});else await apiPost('/reminders',{title,description:description||undefined,scheduled_at:d.toISOString(),timezone:'Europe/Moscow',responsible_member_id:responsible});setTitle('');setDescription('');setShow(false);await refresh()}catch(e:any){setError(String(e.message||e).slice(0,150))}finally{setSaving(false)}}
  const rows=[...events.filter(x=>x.status==='SCHEDULED').map(x=>({...x,_at:new Date(x.start_at),_kind:'Событие'})),...reminders.filter(x=>x.status==='SCHEDULED').map(x=>({...x,_at:new Date(x.scheduled_at),_kind:'Напоминание'}))].sort((a,b)=>a._at-b._at)
  const key=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const daysInMonth=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();const firstOffset=(new Date(month.getFullYear(),month.getMonth(),1).getDay()+6)%7
  const visibleRows=selectedDay?rows.filter(x=>key(x._at)===selectedDay):rows
  return <div className="stack"><SectionTitle title="Семейный календарь" subtitle="События и напоминания видны всем активным участникам семьи." action={<div style={{display:'flex',gap:6}}><button className="button primary small" onClick={()=>{setKind('EVENT');setShow(true)}}>＋ Событие</button><button className="button secondary small" onClick={()=>{setKind('REMINDER');setShow(true)}}>＋ Напоминание</button></div>} />
    {error&&<div className="card" style={{color:'#B91C1C'}}>{error}</div>}{show&&<div className="card"><h3>{kind==='EVENT'?'Новое событие':'Новое напоминание'}</h3><div style={{display:'grid',gap:10}}><input placeholder="Название" value={title} onChange={e=>setTitle(e.target.value)} /><textarea placeholder="Описание (необязательно)" value={description} onChange={e=>setDescription(e.target.value)} /><label>Дата и время<input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)} /></label><label>Ответственный<select value={responsible} onChange={e=>setResponsible(e.target.value)}>{members.map(m=><option key={m.id} value={m.id}>{m.user?.first_name||m.user?.username||'Участник'}</option>)}</select></label><div style={{display:'flex',gap:8}}><button className="button primary" disabled={saving} onClick={submit}>{saving?'Сохраняю…':'Сохранить'}</button><button className="button secondary" onClick={()=>setShow(false)}>Отмена</button></div></div></div>}
    <div className="card"><div className="card-head"><button className="button secondary small" onClick={()=>{setMonth(new Date(month.getFullYear(),month.getMonth()-1,1));setSelectedDay('')}}>‹</button><h3>{month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</h3><button className="button secondary small" onClick={()=>{setMonth(new Date(month.getFullYear(),month.getMonth()+1,1));setSelectedDay('')}}>›</button></div><div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',textAlign:'center',fontSize:11,color:'var(--muted)',marginBottom:6}}>{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=><span key={d}>{d}</span>)}</div><div className="calendar-grid">{Array.from({length:firstOffset},(_,i)=><div key={'blank'+i} />)}{Array.from({length:daysInMonth},(_,i)=>{const day=i+1;const date=new Date(month.getFullYear(),month.getMonth(),day);const dayKey=key(date);const count=rows.filter(x=>key(x._at)===dayKey).length;const today=key(new Date())===dayKey;return <div key={dayKey} className={`cal-day ${today?'today':''}`} onClick={()=>setSelectedDay(selectedDay===dayKey?'':dayKey)} style={{cursor:'pointer',outline:selectedDay===dayKey?'2px solid #0F766E':undefined}}><b>{day}</b>{count>0&&<div style={{display:'flex',gap:3,justifyContent:'center'}}><span className="cal-dot" />{count>1&&<small>{count}</small>}</div>}</div>})}</div><div style={{display:'flex',gap:8,marginTop:10}}><span className="pill"><i className="cal-dot" /> Запланировано: {rows.length}</span>{selectedDay&&<button className="button ghost small" onClick={()=>setSelectedDay('')}>Сбросить выбор даты</button>}</div></div>
    <div className="card"><div className="card-head"><h3>{selectedDay?`План на ${new Date(`${selectedDay}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}`:'Предстоящие события и напоминания'}</h3><button className="button secondary small" onClick={refresh}>Обновить</button></div>{visibleRows.length?visibleRows.map((x:any)=><div className="list-item-card" key={x._kind+x.id}><span className="pill">{x._kind}</span><div style={{flex:1}}><strong>{x.title}</strong><small style={{display:'block',color:'var(--muted)'}}>{x.description||''} · создатель: {x.creator?.first_name||x.creator?.username||'участник'}</small></div><b>{x._at.toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</b></div>):<p className="muted">На выбранную дату нет планов.</p>}</div>
  </div>
}

function FamilyV07(){
  const [family,setFamily]=useState<any>(null)
  const [invitations,setInvitations]=useState<any[]>([])
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [loading,setLoading]=useState(true)
  const [loaded,setLoaded]=useState(false)
  const [busy,setBusy]=useState('')
  const [showInvite,setShowInvite]=useState(false)
  const [expandedMemberId,setExpandedMemberId]=useState<string|null>(null)
  const [inviteTarget,setInviteTarget]=useState('')
  const [inviteName,setInviteName]=useState('')
  const [newFamilyName,setNewFamilyName]=useState('')
  const [familyName,setFamilyName]=useState('')
  const [editingName,setEditingName]=useState(false)
  const [confirmMember,setConfirmMember]=useState<any>(null)
  const [confirmInvitation,setConfirmInvitation]=useState<any>(null)
  const [visibilitySection,setVisibilitySection]=useState<VisibilitySection|null>(null)
  useEffect(()=>{if(!notice)return;const id=window.setTimeout(()=>setNotice(''),6000);return ()=>window.clearTimeout(id)},[notice])
  const isAdmin=family?.my_role==='ADMIN'
  const refresh=async()=>{
    setLoading(true);setError('')
    try{
      const [me,pending]=await Promise.all([apiGet('/me'),apiGet('/family/invitations')])
      setInvitations((pending.data||[]).filter((x:any)=>x.status==='PENDING'))
      if(me.data?.family){
        const result=await apiGet('/family')
        setFamily(result.data);setFamilyName(result.data?.name||'')
      }else{setFamily(null);setFamilyName('')}
      setLoaded(true)
    }catch(e:any){setError(String(e.message||e).slice(0,180))}
    finally{setLoading(false)}
  }
  useEffect(()=>{
    refresh()
    const onVisible=()=>{if(document.visibilityState==='visible')refresh()}
    window.addEventListener('focus',onVisible)
    document.addEventListener('visibilitychange',onVisible)
    return ()=>{window.removeEventListener('focus',onVisible);document.removeEventListener('visibilitychange',onVisible)}
  },[])
  const acceptInvitation=async(invitation:any)=>{
    setBusy(invitation.id);setError('')
    try{await apiPost(`/family/invitations/${invitation.id}/accept`,{});await refresh();window.dispatchEvent(new Event('family-access-changed'));setNotice('Вы присоединились к семье. Общие разделы теперь доступны.')}
    catch(e:any){setError(String(e.message||e).slice(0,180))}finally{setBusy('')}
  }
  const createFamily=async()=>{
    const name=newFamilyName.trim()
    if(!name){setError('Введите название семьи.');return}
    setBusy('create');setError('')
    try{await apiPost('/families',{name});setNewFamilyName('');await refresh();window.dispatchEvent(new Event('family-access-changed'))}
    catch(e:any){setError(String(e.message||e).slice(0,180))}finally{setBusy('')}
  }
  const saveFamilyName=async()=>{
    const name=familyName.trim()
    if(!name){setError('Название семьи не может быть пустым.');return}
    setBusy('name');setError('')
    try{const result=await apiPatch('/family',{name});setFamily(result.data);setFamilyName(result.data?.name||name);setEditingName(false)}
    catch(e:any){setError(String(e.message||e).slice(0,180))}finally{setBusy('')}
  }
  const invite=async()=>{
    const raw=inviteTarget.trim().replace(/^@/,'')
    if(!raw){setError('Укажите Telegram ID или логин участника.');return}
    const body:any={first_name:inviteName.trim()||undefined}
    if(/^\d+$/.test(raw))body.telegram_user_id=Number(raw);else body.username=raw
    setBusy('invite');setError('')
    try{const result=await apiPost('/family/invitations',body);setInviteTarget('');setInviteName('');setShowInvite(false);await refresh();setNotice(result.data?.telegram_user_id?'Приглашение создано и поставлено в очередь бота. Оно также доступно участнику в разделе «Семья».':'Приглашение создано. Попросите участника открыть Family Hub через бота: приглашение появится в разделе «Семья».')}
    catch(e:any){setError(String(e.message||e).slice(0,180))}finally{setBusy('')}
  }
  const changeRole=async(member:any,role:'ADMIN'|'USER')=>{
    if(member.role===role)return
    setBusy(member.id);setError('')
    try{await apiPatch(`/family/members/${member.id}`,{role});await refresh()}
    catch(e:any){setError(String(e.message||e).slice(0,180));await refresh()}finally{setBusy('')}
  }
  const removeMember=async()=>{
    if(!confirmMember)return
    setBusy(confirmMember.id);setError('')
    try{const r=await fetch(`/api/v1/family/members/${confirmMember.id}`,{method:'DELETE',headers:getAuthHeaders()});if(!r.ok)throw await apiError(r);setConfirmMember(null);await refresh()}
    catch(e:any){setError(String(e.message||e).slice(0,180))}finally{setBusy('')}
  }
  const cancelInvitation=async(invitation:any)=>{
    setBusy(invitation.id);setError('')
    try{const r=await fetch(`/api/v1/family/invitations/${invitation.id}`,{method:'DELETE',headers:getAuthHeaders()});if(!r.ok)throw await apiError(r);setConfirmInvitation(null);await refresh()}
    catch(e:any){setError(String(e.message||e).slice(0,180))}finally{setBusy('')}
  }
  const copyInvitation=async(invitation:any)=>{
    const identity=invitation.username?`@${String(invitation.username).replace(/^@/,'')}`:`Telegram ID ${invitation.telegram_user_id}`
    try{await navigator.clipboard.writeText(`Приглашение в семью «${family?.name}» для ${identity}. Откройте Family Hub и примите приглашение в разделе «Семья».`);setNotice('Текст приглашения скопирован. Отправьте его участнику в Telegram.')}
    catch{setError('Не удалось скопировать текст. Разрешите доступ к буферу обмена браузера.')}
  }
  const setMemberVisibility=async(member:any,section:VisibilitySection,visible:boolean)=>{
    setBusy(member.id);setError('')
    try{const result=await apiPatch(`/family/members/${member.id}/visibility`,{visibility:{[section]:visible}});setFamily(result.data);window.dispatchEvent(new Event('family-access-changed'))}
    catch(e:any){setError(String(e.message||e).slice(0,180))}finally{setBusy('')}
  }
  useEffect(()=>{
    if(!visibilitySection)return
    const dialog=document.querySelector<HTMLDialogElement>('#family-visibility-dialog')
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null
    dialog?.showModal()
    return ()=>{dialog?.close();window.requestAnimationFrame(()=>previousFocus?.focus())}
  },[visibilitySection])
  const initials=(member:any)=>`${member.user?.first_name?.[0]||''}${member.user?.last_name?.[0]||''}`.toUpperCase()||'👤'
  if(loading&&!family&&!error)return <div className="stack"><SectionTitle title="Семья" subtitle="Загружаем семейное пространство…"/><div className="card family-loading">Загружаем участников и приглашения…</div></div>
  if(!loaded&&!family)return <div className="stack"><SectionTitle title="Семья" subtitle="Не удалось загрузить семейное пространство."/><div className="family-alert" role="alert">{error}</div><button className="button secondary" onClick={refresh}>Попробовать ещё раз</button></div>
  if(!family)return <div className="stack family-page"><SectionTitle title="Семья" subtitle="Примите приглашение близких или создайте своё семейное пространство." action={<button className="button secondary family-refresh" onClick={refresh} disabled={loading} aria-label="Обновить приглашения">↻ <span>Обновить</span></button>}/>{error&&<div className="family-alert" role="alert">{error}</div>}{invitations.length>0&&<section className="card family-incoming"><h3>Вас приглашают в семью</h3>{invitations.map(inv=><article className="family-invitation" key={inv.id}><div className="family-member-info"><strong>{inv.family?.name||'Семья'}</strong><span>Приглашает {inv.inviter?.first_name||inv.inviter?.username||'администратор семьи'}{inv.expires_at?` · до ${new Date(inv.expires_at).toLocaleDateString('ru-RU')}`:''}</span></div><button className="button primary" disabled={!!busy||loading} onClick={()=>acceptInvitation(inv)}>{busy===inv.id?'Присоединяемся…':'Принять приглашение'}</button></article>)}</section>}<div className="card family-create"><div className="family-hero-icon">👨‍👩‍👧</div><h3>{invitations.length?'Или создайте свою семью':'Создайте семью'}</h3><p>После создания вы сможете пригласить близких и вести общие дела.</p><label>Название семьи<input value={newFamilyName} onChange={e=>setNewFamilyName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createFamily()} placeholder="Например, Семья Зубаревых" maxLength={120}/></label><button className="button primary full" disabled={!!busy||loading} onClick={createFamily}>{busy==='create'?'Создаём…':'Создать семейное пространство'}</button></div></div>
  return <div className="stack family-page">
    <SectionTitle title="Семья" action={<button className="family-icon-button" onClick={refresh} disabled={loading} aria-label="Обновить состав семьи">↻</button>} />
    {error&&<div className="family-alert" role="alert">{error}</div>}
    {notice&&<div className="family-notice" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Закрыть уведомление">×</button></div>}
    <section className="card family-overview" aria-label="Информация о семье">
      <div className="family-overview-main">
        <div className="family-hero-icon" aria-hidden="true"><FamilySymbol kind="home"/></div>
        <div className="family-title-block">
          {editingName&&isAdmin?<><label className="family-name-edit"><span className="sr-only">Название семьи</span><input value={familyName} maxLength={120} onChange={e=>setFamilyName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveFamilyName()}/></label><div className="family-inline-actions"><button className="button primary small" onClick={saveFamilyName} disabled={busy==='name'}>Сохранить</button><button className="button secondary small" onClick={()=>{setFamilyName(family.name);setEditingName(false)}}>Отмена</button></div></>:<h3>{family.name}</h3>}
          <p>{family.members?.length||0} {pluralRu(family.members?.length||0,'участник','участника','участников')}{isAdmin&&invitations.length>0?` · ${invitations.length} ${pluralRu(invitations.length,'приглашение','приглашения','приглашений')}`:''}</p>
        </div>
        {isAdmin&&!editingName&&<button className="family-icon-button" onClick={()=>setEditingName(true)} aria-label="Изменить название" title="Изменить название"><FamilySymbol kind="edit"/></button>}
      </div>
    </section>
    <section className="card family-members-card" aria-labelledby="family-members-title">
      <div className="card-head"><h3 id="family-members-title">Участники <span className="family-heading-count">{family.members?.length||0}</span></h3>{isAdmin&&<button className="family-text-button" onClick={()=>setShowInvite(v=>!v)}>{showInvite?'Закрыть':'＋ Пригласить'}</button>}</div>
      {showInvite&&isAdmin&&<div className="family-invite-form"><div className="family-form-fields"><label><span>Telegram ID<br/>или логин</span><input value={inviteTarget} onChange={e=>setInviteTarget(e.target.value)} placeholder="@username / ID" autoComplete="off"/></label><label><span>Имя <span className="muted">(необязательно)</span></span><input value={inviteName} onChange={e=>setInviteName(e.target.value)} placeholder="Имя участника" maxLength={255}/></label></div><button className="button primary full" onClick={invite} disabled={busy==='invite'}>{busy==='invite'?'Создаём…':'Создать приглашение'}</button></div>}
      <div className="family-member-list">{family.members?.map((m:any)=><article className="family-member" key={m.id}>
        <div className="family-avatar">{m.user?.avatar_url?<img src={m.user.avatar_url} alt=""/>:initials(m)}</div>
        <div className="family-member-info"><div className="family-member-name-row"><strong title={m.user?.first_name||m.user?.username}>{m.user?.first_name||m.user?.username||'Участник'}{m.id===family.current_member_id&&<span className="family-you"> · вы</span>}</strong><span className={`family-role ${m.role==='ADMIN'?'admin':''}`} title={m.role==='ADMIN'?'Администратор':'Участник'}>{m.role==='ADMIN'?'Админ':'Участник'}</span></div><span title={m.user?.username?`@${m.user.username}`:''}>{m.user?.username?`@${String(m.user.username).replace(/^@/,'')}`:'Участник семьи'}</span></div>
        {isAdmin&&m.id!==family.current_member_id&&<button className="family-member-menu" aria-label={`Действия участника: ${m.user?.first_name||'участника'}`} aria-expanded={expandedMemberId===m.id} aria-controls={`family-member-actions-${m.id}`} onClick={()=>setExpandedMemberId(v=>v===m.id?null:m.id)}>•••</button>}
        {isAdmin&&m.id!==family.current_member_id&&expandedMemberId===m.id&&<div className="family-member-actions" id={`family-member-actions-${m.id}`}><label>Роль<select value={m.role} disabled={!!busy} onChange={e=>changeRole(m,e.target.value as 'ADMIN'|'USER')}><option value="USER">Участник</option><option value="ADMIN">Админ</option></select></label><button className="tiny danger" aria-label="Удалить из семьи" onClick={()=>setConfirmMember(m)}>Удалить</button></div>}
      </article>)}</div>
    </section>
    <section className="card family-access-card" aria-labelledby="family-access-title">
      <div className="card-head"><h3 id="family-access-title">Общий доступ</h3><small>{isAdmin?'Видимость разделов':'Ваши разделы'}</small></div>
      <div className="family-access-list">{SHARED_SECTIONS.map(section=>{
        const visible=(family.members||[]).filter((m:any)=>m.visibility?.[section.id]!==false).length
        const mine=family.my_visibility?.[section.id]!==false
        return <div className="family-access-row" key={section.id}><span className="family-section-icon" aria-hidden="true"><FamilySymbol kind={section.id}/></span><div className="family-access-copy"><strong>{section.title}</strong><small>{isAdmin?`${visible} из ${family.members?.length||0} участников`:mine?'Доступен':'Скрыт администратором'}</small></div>{isAdmin&&<button className="family-icon-button" aria-label={`Настроить видимость: ${section.title}`} onClick={()=>setVisibilitySection(section.id)}><FamilySymbol kind="settings"/></button>}</div>
      })}</div>
    </section>
    {isAdmin&&invitations.length>0&&<details className="card family-invitations-card" open><summary className="family-invitations-summary">Приглашения <span className="family-heading-count">{invitations.length}</span></summary>{invitations.map((inv:any)=><div className="family-invitation" key={inv.id}><div className="family-member-info"><strong>{inv.first_name||(inv.username?`@${String(inv.username).replace(/^@/,'')}`:`Telegram ID ${inv.telegram_user_id}`)}</strong><span>Ожидает ответа{inv.expires_at?` · до ${new Date(inv.expires_at).toLocaleDateString('ru-RU')}`:''}</span></div><div className="family-invitation-actions"><button className="tiny" onClick={()=>copyInvitation(inv)}>Копировать</button><button className="tiny danger" disabled={busy===inv.id} onClick={()=>setConfirmInvitation(inv)}>Отменить</button></div></div>)}</details>}
    {visibilitySection&&<dialog id="family-visibility-dialog" className="family-visibility-dialog" aria-labelledby="family-visibility-title" onCancel={()=>setVisibilitySection(null)} onClick={e=>{if(e.target===e.currentTarget)setVisibilitySection(null)}}>
      <div className="modal-head"><h2 id="family-visibility-title">{SHARED_SECTIONS.find(s=>s.id===visibilitySection)?.title}</h2><button className="family-icon-button" onClick={()=>setVisibilitySection(null)} aria-label="Закрыть настройки видимости">×</button></div>
      <p className="family-visibility-note">Кому виден раздел. Изменения сохраняются сразу.</p><div className="family-visibility-list">
      {family.members?.map((m:any)=><label className="family-visibility-member" key={m.id}><div className="family-avatar">{m.user?.avatar_url?<img src={m.user.avatar_url} alt=""/>:initials(m)}</div><span><strong>{m.user?.first_name||m.user?.username||'Участник'}</strong><small>{m.role==='ADMIN'?'Админ · полный доступ':busy===m.id?'Сохраняем…':'Участник'}</small></span><input type="checkbox" role="switch" aria-label={`${m.user?.first_name||m.user?.username||'Участник'}: ${SHARED_SECTIONS.find(s=>s.id===visibilitySection)?.title}`} checked={m.visibility?.[visibilitySection]!==false} disabled={m.role==='ADMIN'||!!busy} onChange={e=>setMemberVisibility(m,visibilitySection,e.target.checked)}/></label>)}
      </div>{error&&<div className="family-alert" role="alert">{error}</div>}
      <p className="family-visibility-note">Администраторам доступны все разделы. Ограничить видимость можно для роли «Участник». Скрытые данные не показываются в приложении и не приходят в уведомлениях.</p>
      <button className="button primary full" onClick={()=>setVisibilitySection(null)}>Готово</button>
    </dialog>}
    {confirmMember&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>e.target===e.currentTarget&&setConfirmMember(null)}><section className="modal-sheet family-confirm" role="dialog" aria-modal="true" aria-labelledby="family-remove-title"><div className="modal-head"><h2 id="family-remove-title">Удалить участника?</h2><button onClick={()=>setConfirmMember(null)} aria-label="Закрыть">×</button></div><p><strong>{confirmMember.user?.first_name||confirmMember.user?.username||'Участник'}</strong> потеряет доступ к общему пространству. Данные семьи сохранятся.</p><div className="modal-actions"><button className="button secondary" onClick={()=>setConfirmMember(null)}>Оставить</button><button className="button primary family-danger-button" disabled={!!busy} onClick={removeMember}>{busy?'Удаляем…':'Удалить участника'}</button></div></section></div>}
    {confirmInvitation&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>e.target===e.currentTarget&&setConfirmInvitation(null)}><section className="modal-sheet family-confirm" role="dialog" aria-modal="true" aria-labelledby="family-invite-cancel-title"><div className="modal-head"><h2 id="family-invite-cancel-title">Отменить приглашение?</h2><button onClick={()=>setConfirmInvitation(null)} aria-label="Закрыть">×</button></div><p>Приглашение для <strong>{confirmInvitation.first_name||confirmInvitation.username||`Telegram ID ${confirmInvitation.telegram_user_id}`}</strong> перестанет действовать.</p><div className="modal-actions"><button className="button secondary" onClick={()=>setConfirmInvitation(null)}>Оставить</button><button className="button primary family-danger-button" disabled={!!busy} onClick={()=>cancelInvitation(confirmInvitation)}>Отменить приглашение</button></div></section></div>}
  </div>
}
function SectionTitle(p:{title:string; subtitle?:string; action?:any}){
  return <div className="section-title"><div><h2>{p.title}</h2>{p.subtitle && <p>{p.subtitle}</p>}</div>{p.action}</div>
}
