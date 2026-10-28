import { useEffect, useMemo, useState } from 'react'
import './styles.v07.css'
import './family.css'
import FinanceScreen from './FinanceScreen'
import ShoppingScreen from './ShoppingScreen'
import CalendarScreen from './CalendarScreen'
import HomeScreen from './HomeScreen'
import WelcomeScreen, { type FirstAction } from './WelcomeScreen'
import { DEFAULT_TIMEZONE, TIMEZONES, timezoneLabel } from './lib/timezone'

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
  const [calendarAction,setCalendarAction]=useState<'EVENT'|'REMINDER'|undefined>()
  const [financeTarget,setFinanceTarget]=useState<'overview'|'receipts'|'credits'|'cashback'>('overview')
  const [homeReceipt,setHomeReceipt]=useState<File|null>(null)
  const [accessError,setAccessError]=useState('')
  const [hasFamily,setHasFamily]=useState<boolean|null>(null)
  const [firstAction,setFirstAction]=useState<FirstAction|null>(null)
  const [onboardingActive,setOnboardingActive]=useState(false)
  const [showFirstSuccess,setShowFirstSuccess]=useState(false)
  const [openFamilyInvite,setOpenFamilyInvite]=useState(false)
  const completeWelcome=async(action:FirstAction,created:boolean)=>{
    const result=await apiGet('/me')
    if(!result.data?.family)throw new Error('Не удалось загрузить семью. Попробуйте ещё раз.')
    const visibility={...ALL_VISIBLE,...result.data.family.visibility}
    setAccess(visibility);setFamilyRole(result.data.family.role||'');setHasFamily(true)
    setFirstAction(created?action:null);setOnboardingActive(created)
    if(action==='calendar')setCalendarAction('EVENT')
    const target=action==='shopping'?'lists':action
    setSection(canOpenSection(target,visibility)?target:'home')
  }
  useEffect(()=>{
    const saved=()=>{if(onboardingActive){setShowFirstSuccess(true);setOnboardingActive(false)}}
    window.addEventListener('family-first-entry-saved',saved)
    return()=>window.removeEventListener('family-first-entry-saved',saved)
  },[onboardingActive])
  useEffect(()=>{
    let active=true
    const refreshAccess=()=>apiGet('/me').then(result=>{
      if(!active)return
      setHasFamily(!!result.data?.family)
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

  return <div className={`app-shell${hasFamily===false?' is-welcome':''}`}>
    {/* TOPBAR */}
    <header className="topbar">
      <h1>Family Hub</h1>
    </header>

    <main className="page">
      {accessError&&<div className="family-alert" role="alert">{accessError}</div>}
      {!access&&!accessError&&<div className="family-loading">Загружаем пространство…</div>}
      {access&&hasFamily===false&&<WelcomeScreen apiGet={apiGet} apiPost={apiPost} onComplete={completeWelcome}/>}
      {hasFamily&&showFirstSuccess&&<aside className="onboarding-success" role="status"><strong>Первая запись сохранена</strong><p>Пригласите близкого, чтобы пользоваться Family Hub вместе. Видимость общих разделов настраивается в «Семье».</p><div className="onboarding-success-actions"><button className="button primary" onClick={()=>{setShowFirstSuccess(false);setOpenFamilyInvite(true);setSection('family')}}>Пригласить близкого</button><button className="button secondary" onClick={()=>setShowFirstSuccess(false)}>Позже</button></div></aside>}
      {hasFamily&&access&&section==='home' && <HomeScreen apiGet={apiGet} visibility={access} onFamily={()=>setSection('family')} onCalendar={kind=>{setCalendarAction(kind);setSection('calendar')}} onFinance={tab=>{setFinanceTarget(tab);setSection('finance')}} onReceipt={file=>{setHomeReceipt(file);setFinanceTarget('receipts');setSection('finance')}} />}
      {access?.calendar&&section==='calendar' && <CalendarScreen initialKind={calendarAction} onActionConsumed={()=>setCalendarAction(undefined)} />}
      {access?.shopping&&section==='lists' && <ShoppingScreen isAdmin={familyRole==='ADMIN'} startInStore={firstAction==='shopping'} onStartConsumed={()=>setFirstAction(null)} />}
      {access?.finance&&section==='finance' && <FinanceScreen initialExpense={firstAction==='finance'} onInitialExpenseConsumed={()=>setFirstAction(null)} initialTab={financeTarget} initialReceiptFile={homeReceipt} onReceiptConsumed={()=>setHomeReceipt(null)} />}
      {hasFamily&&access&&section==='family' && <FamilyV07 initialInvite={openFamilyInvite} onInviteConsumed={()=>setOpenFamilyInvite(false)} />}
    </main>

    {hasFamily&&<nav className="bottom-nav" aria-label="Основная навигация" style={{gridTemplateColumns:`repeat(${2+Number(!!access?.calendar)+Number(!!access?.shopping)+Number(!!access?.finance)},minmax(0,1fr))`}}>
      <Nav active={section==='home'} label="Главная" icon="⌂" onClick={()=>setSection('home')} />
      {access?.calendar&&<Nav active={section==='calendar'} label="Календарь" icon="▦" onClick={()=>setSection('calendar')} />}
      {access?.shopping&&<Nav active={section==='lists'} label="Покупки" icon="☷" onClick={()=>setSection('lists')} />}
      {access?.finance&&<Nav active={section==='finance'} label="Финансы" icon="₽" onClick={()=>{setFinanceTarget('overview');setSection('finance')}} />}
      <Nav active={section==='family'} label="Семья" icon="👨‍👩‍👧" onClick={()=>setSection('family')} />
    </nav>}
  </div>
}

function Nav(p:{active:boolean; label:string; icon:string; onClick:()=>void}){
  return <button className={p.active?'nav-item active':'nav-item'} onClick={p.onClick}>
    <span aria-hidden="true" style={{fontSize:18}}>{p.icon}</span><small>{p.label}</small>
  </button>
}

function FamilyV07({initialInvite=false,onInviteConsumed}:{initialInvite?:boolean;onInviteConsumed?:()=>void}){
  const [family,setFamily]=useState<any>(null)
  const [invitations,setInvitations]=useState<any[]>([])
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [loading,setLoading]=useState(true)
  const [loaded,setLoaded]=useState(false)
  const [busy,setBusy]=useState('')
  const [showInvite,setShowInvite]=useState(initialInvite)
  useEffect(()=>{if(initialInvite)onInviteConsumed?.()},[])
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
  const saveTimezone=async(timezone:string)=>{
    setBusy('timezone');setError('')
    try{const result=await apiPatch('/family',{timezone});setFamily(result.data);setNotice('Часовой пояс семьи сохранён.')}
    catch(e:any){setError(String(e.message||e).slice(0,180))}finally{setBusy('')}
  }
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
      <div className="family-timezone"><span>Часовой пояс</span>{isAdmin?<select aria-label="Часовой пояс семьи" value={family.timezone||DEFAULT_TIMEZONE} onChange={e=>void saveTimezone(e.target.value)} disabled={!!busy}>{TIMEZONES.map(zone=><option key={zone} value={zone}>{timezoneLabel(zone)}</option>)}</select>:<strong>{timezoneLabel(family.timezone||DEFAULT_TIMEZONE)}</strong>}</div>
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
