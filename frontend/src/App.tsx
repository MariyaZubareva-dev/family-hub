import { useEffect, useMemo, useState } from 'react'
import './styles.v07.css'

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

const rub = (v:number)=> `${v.toLocaleString('ru-RU')} ₽`
const shortRub = (v:number)=> v>=1000? `${(v/1000).toFixed(v>=10000?0:1)}k ₽` : `${v} ₽`

type Section = 'home'|'calendar'|'lists'|'finance'|'family'
type FinanceTab = 'overview'|'categories'|'receipts'|'stocks'|'large'|'credits'|'budget'

export default function App(){
  const [section,setSection]=useState<Section>(()=>{const target=new URLSearchParams(window.location.search).get('section');return ['home','calendar','lists','finance','family'].includes(target||'')?target as Section:'home'})
  const [fTab,setFTab]=useState<FinanceTab>('overview')
  const [selectedCat,setSelectedCat]=useState<string|null>(null)
  const [receiptItems,setReceiptItems]=useState<any[]>([])
  const [showReceiptConfirm,setShowReceiptConfirm]=useState(false)
  const [monthlyPlan,setMonthlyPlan]=useState(10000)
  useEffect(()=>{
    // New users need to accept an invitation before opening shared sections.
    if(new URLSearchParams(window.location.search).has('section'))return
    let active=true
    apiGet('/me').then(result=>{if(active&&!result.data?.family)setSection('family')}).catch(()=>{})
    return ()=>{active=false}
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
      <div>
        <div className="eyebrow">Семейное пространство</div>
        <h1>Family Hub</h1>
      </div>
      <div className="topbar-right">
        <span className="badge-pill">Семейный кабинет</span>
        <div className="user-badge">👨‍👩‍👧</div>
      </div>
    </header>

    <main className="page">
      {section==='home' && <HomeView onGo={setSection} totalExpense={totalExpense} />}
      {section==='calendar' && <CalendarV07 />}
      {section==='lists' && <ListsV07 />}
      {section==='finance' && <FinanceV07 
        fTab={fTab} setFTab={setFTab}
        totalExpense={totalExpense} ranked={ranked} donutData={donutData}
        selectedCat={selectedCat} setSelectedCat={setSelectedCat}
        receiptItems={receiptItems} setReceiptItems={setReceiptItems}
        showReceiptConfirm={showReceiptConfirm} setShowReceiptConfirm={setShowReceiptConfirm}
        monthlyPlan={monthlyPlan} setMonthlyPlan={setMonthlyPlan}
      />}
      {section==='family' && <FamilyV07 />}
    </main>

    <nav className="bottom-nav">
      <Nav active={section==='home'} label="Главная" icon="⌂" onClick={()=>setSection('home')} />
      <Nav active={section==='calendar'} label="Календарь" icon="▦" onClick={()=>setSection('calendar')} />
      <Nav active={section==='lists'} label="Покупки" icon="☷" onClick={()=>setSection('lists')} />
      <Nav active={section==='finance'} label="Финансы" icon="₽" onClick={()=>setSection('finance')} />
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
function HomeView(p:{onGo:(s:Section)=>void; totalExpense:number}){
  const [events,setEvents]=useState<any[]>([]);const [reminders,setReminders]=useState<any[]>([]);const [credits,setCredits]=useState<any[]>([]);const [analytics,setAnalytics]=useState<any>(null)
  useEffect(()=>{const n=new Date();const q=`?period=month&year=${n.getFullYear()}&month=${n.getMonth()+1}`;Promise.allSettled([apiGet('/events'),apiGet('/reminders'),apiGet('/credits'),apiGet('/finance/analytics'+q)]).then(r=>{if(r[0].status==='fulfilled')setEvents(r[0].value.data||[]);if(r[1].status==='fulfilled')setReminders(r[1].value.data||[]);if(r[2].status==='fulfilled')setCredits(r[2].value.data||[]);if(r[3].status==='fulfilled')setAnalytics(r[3].value.data)})},[])
  const soon=[...events.filter(x=>x.status==='SCHEDULED').map(x=>({...x,_at:new Date(x.start_at),_kind:'Событие'})),...reminders.filter(x=>x.status==='SCHEDULED').map(x=>({...x,_at:new Date(x.scheduled_at),_kind:'Напоминание'}))].filter(x=>x._at>=new Date()).sort((a,b)=>a._at-b._at).slice(0,5)
  const cats=(analytics?.ranked||[]).slice(0,6);const max=Math.max(1,...cats.map((c:any)=>Number(c.amount)||0))
  const next=credits.map(c=>{const [y,m,day]=String(c.first_payment_date).slice(0,10).split('-').map(Number);const first=new Date(y,m-1,day);const today=new Date();today.setHours(0,0,0,0);const addMonth=(n:number)=>{const ix=first.getFullYear()*12+first.getMonth()+n;const yr=Math.floor(ix/12);const mo=ix%12;return new Date(yr,mo,Math.min(first.getDate(),new Date(yr,mo+1,0).getDate()))};let idx=Math.max(0,(today.getFullYear()-first.getFullYear())*12+today.getMonth()-first.getMonth());let d=addMonth(idx);if(d<today){idx++;d=addMonth(idx)}const installment=idx+1;const part=(c.payment_schedule||[]).find((x:any)=>installment>=Number(x.from_month)&&installment<=Number(x.to_month));return {...c,_next:d,_nextAmount:Number(part?.amount??c.standard_payment)}}).sort((a,b)=>a._next-b._next).slice(0,4)
  return <div className="stack"><SectionTitle title="Обзор семьи" subtitle={new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})} />
    <div className="grid-2"><div className="card"><div className="card-head"><h3>События и напоминания</h3><button className="button secondary small" onClick={()=>p.onGo('calendar')}>Календарь →</button></div>{soon.length?soon.map((x:any)=><div className="list-item-card" key={x._kind+x.id}><span className="pill">{x._kind}</span><strong style={{flex:1}}>{x.title}</strong><small>{x._at.toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</small></div>):<p className="muted">Ближайших событий и напоминаний нет.</p>}<button className="button primary small" onClick={()=>p.onGo('calendar')}>＋ Добавить</button></div>
      <div className="card"><div className="card-head"><h3>Бюджет за месяц</h3><button className="button secondary small" onClick={()=>p.onGo('finance')}>Финансы →</button></div><div className="grid-3"><div className="metric"><small>Доходы</small><strong>{rub(Number(analytics?.total_income)||0)}</strong></div><div className="metric"><small>Расходы</small><strong>{rub(Number(analytics?.total_expense)||0)}</strong></div><div className="metric balance"><small>Остаток</small><strong style={{color:(Number(analytics?.balance)||0)>=0?'#0F766E':'#E11D48'}}>{rub(Number(analytics?.balance)||0)}</strong></div></div>{cats.length?cats.map((c:any)=><div key={c.id||c.name} style={{marginTop:8}}><div className="summary-line"><span>{c.name}</span><b>{rub(Number(c.amount)||0)}</b></div><div className="progress"><span style={{width:`${Math.max(2,Number(c.amount)/max*100)}%`,background:c.color||'#0F766E'}} /></div></div>):<p className="muted">Расходы появятся после добавления операций.</p>}</div></div>
    <div className="card"><div className="card-head"><h3>Ближайшие платежи по кредитам</h3><button className="button secondary small" onClick={()=>{p.onGo('finance')}}>Кредиты →</button></div>{next.length?next.map((c:any)=><div className="list-item-card" key={c.id}><strong style={{flex:1}}>{c.name||'Кредит'}</strong><span>{c._next.toLocaleDateString('ru-RU')}</span><b>{rub(Number(c._nextAmount)||0)}</b></div>):<p className="muted">Кредиты не добавлены.</p>}</div>
  </div>
}

function FinanceV07(p:{
  fTab:FinanceTab; setFTab:(t:FinanceTab)=>void;
  totalExpense:number; ranked:Cat[]; donutData:Cat[];
  selectedCat:string|null; setSelectedCat:(s:string|null)=>void;
  receiptItems:any[]; setReceiptItems:(a:any[])=>void;
  showReceiptConfirm:boolean; setShowReceiptConfirm:(b:boolean)=>void;
  monthlyPlan:number; setMonthlyPlan:(n:number)=>void;
}){
  const [activeCat,setActiveCat]=useState<string|null>(null)
  const [showAll,setShowAll]=useState(false)
  const [showLimits,setShowLimits]=useState(true)
  const [selectedMonth,setSelectedMonth]=useState('sep')
  const [quickFilter,setQuickFilter]=useState<'all'|'over'|'food'|'home'>('all')
  const [period,setPeriod]=useState<'month'|'3m'|'6m'|'year'>('month')
  const [apiData,setApiData]=useState<any>(null)
  const [loading,setLoading]=useState(false)
  const [apiError,setApiError]=useState<string|null>(null)
  const [refreshKey,setRefreshKey]=useState(0)
  const [addModal,setAddModal]=useState<null|{type:'EXPENSE'|'INCOME', catId?:string}>(null)
  const [catList,setCatList]=useState<any[]>([])
  const [formAmount,setFormAmount]=useState('')
  const [formCat,setFormCat]=useState('')
  const [formDate,setFormDate]=useState(new Date().toISOString().slice(0,10))
  const [formDesc,setFormDesc]=useState('')
  const [savingTx,setSavingTx]=useState(false)

  useEffect(()=>{
    apiGet('/finance/categories').then(j=> setCatList(j.data||[])).catch(()=>{})
  },[])

  useEffect(()=>{
    let cancelled=false
    const now=new Date(); const year=now.getFullYear(), month=now.getMonth()+1
    const q = period==='month' ? `?period=month&year=${year}&month=${month}` : `?period=${period}`
    setLoading(true); setApiError(null)
    apiGet(`/finance/analytics${q}`).then(j=>{ if(!cancelled){ setApiData(j.data) } }).catch(e=>{ if(!cancelled) setApiError(String(e.message).slice(0,120)) }).finally(()=>{ if(!cancelled) setLoading(false) })
    return ()=>{cancelled=true}
  },[period, refreshKey])

  const openAdd = (type:'EXPENSE'|'INCOME', catId?:string)=>{
    const catName = catId ? (catList.find((c:any)=>c.id===catId)?.name || CATS.find(c=>c.id===catId)?.name || '') : ''
    setFormCat(catName)
    setFormAmount('')
    setFormDesc('')
    setFormDate(new Date().toISOString().slice(0,10))
    setAddModal({type, catId})
  }
  const submitAdd = async ()=>{
    const amount = parseFloat(formAmount.replace(',','.'))
    if(!amount || amount<=0){ alert('Введите сумму'); return }
    if(!formCat){ alert('Выберите категорию'); return }
    setSavingTx(true)
    try{
      const catObj = catList.find((c:any)=>c.name===formCat) || CATS.find(c=>c.name===formCat)
      const body:any = {
        type: addModal!.type,
        amount,
        category: formCat,
        category_id: catObj?.id,
        occurred_on: formDate,
        description: formDesc || undefined,
      }
      await apiPost('/finances', body)
      setAddModal(null)
      setRefreshKey(k=>k+1)
      // also refresh categories if new one? not needed
    }catch(e:any){
      alert('Ошибка: '+String(e.message||e).slice(0,150))
    }finally{ setSavingTx(false) }
  }

  const displayTotal: number = apiData?.total_expense ?? 0
  const displayIncome: number = apiData?.total_income ?? 0
  const displayBalance: number = apiData?.balance ?? (displayIncome - displayTotal)
  // api ranked already has icon/color/amount/percent/limit
  const displayRanked: any[] = apiData?.ranked ?? []
  const displayDonut: any[] = apiData?.donut ?? displayRanked
  const displayTrend: any[] | null = apiData?.trend ?? null

  const filteredRanked = useMemo(()=>{
    let d=[...displayRanked]
    if(quickFilter==='over') d=d.filter((c:any)=>c.limit_amount!==null && c.limit_amount!==undefined ? c.amount>c.limit_amount : (c.budget && c.amount>c.budget))
    if(quickFilter==='food') d=d.filter((c:any)=>['products','eating_out'].includes(c.id))
    if(quickFilter==='home') d=d.filter((c:any)=>['home','services'].includes(c.id))
    return d
  },[displayRanked, quickFilter])
  const visibleRanked = showAll ? filteredRanked : filteredRanked.slice(0,8)
  const trendNotes:Record<string,string> = {
    apr:'Апрель: доходы 120k, расходы 95k. Спокойный месяц.',
    may:'Май: +12% к апрелю.',
    jun:'Июнь: пик доходов 165k.',
    jul:'Июль: расходы почти догнали доходы (145k).',
    aug:'Август: расходы упали на 20% — экономия.',
    sep:'Сентябрь: +32% расходов к августу из-за Покупок. Теп 6 мес вверху.'
  }
  const activeCatObj = activeCat ? displayRanked.find((c:any)=>c.id===activeCat) || displayDonut.find((c:any)=>c.id===activeCat) : null
  const donutCenter = activeCatObj ? rub(activeCatObj.amount) : rub(displayTotal)
  const donutSub = activeCatObj ? `${Math.round(activeCatObj.amount/displayTotal*100)}% • тап сброс` : 'тап по сегменту — фильтр'

  return <div className="stack">
    <SectionTitle title="Финансы" subtitle="Вверху графики, ниже детали • современный анализ" action={<span className="pill live">● LIVE v07 • Teal</span>} />
    <div className="finance-tabs">
      {[
        ['overview','Обзор'],
        ['categories','Категории'],
        ['receipts','Чеки'],
        ['stocks','Запасы'],
        ['credits','Кредиты'],
        ['budget','Бюджет'],
      ].map(([k,l])=><button key={k} className={p.fTab===k?'finance-tab active':'finance-tab'} onClick={()=>p.setFTab(k as FinanceTab)}>{l}</button>)}
    </div>

    {p.fTab==='overview' && <>
      {/* TOP METRICS — live from API */}
      <div className="grid-3">
        <div className="metric"><small>Доходы</small><strong style={{color:'#0D9A6E'}}>{rub(displayIncome)}</strong><small style={{fontSize:11}}>Работа + кешбэк {loading?'• загрузка…':''}</small></div>
        <div className="metric"><small>Расходы</small><strong style={{color:'#E11D48'}}>{rub(displayTotal)}</strong><small style={{fontSize:11}}>{displayRanked.length} категорий</small></div>
        <div className="metric balance"><small>Баланс</small><strong style={{color: displayBalance>=0?'#0F766E':'#E11D48'}}>{(displayBalance>=0?'+':'')+rub(displayBalance)}</strong><small style={{fontSize:11, color:'#0F766E'}}>{displayIncome? Math.round(displayBalance/displayIncome*100)+'% от доходов':''}</small></div>
      </div>
      {apiError && <div style={{padding:'8px 10px',background:'#FFE4E6',border:'1px solid #FECDD3',borderRadius:10,fontSize:12,color:'#9F1239'}}>Не удалось загрузить аналитику финансов. {apiError.slice(0,80)}</div>}

      <div className="segmented" style={{marginBottom:0}}>
        <button className={period==='month'?'active':''} onClick={()=>setPeriod('month')}>Месяц</button>
        <button className={period==='3m'?'active':''} onClick={()=>setPeriod('3m')}>3 мес</button>
        <button className={period==='6m'?'active':''} onClick={()=>setPeriod('6m')}>6 мес</button>
        <button className={period==='year'?'active':''} onClick={()=>setPeriod('year')}>Год</button>
      </div>

      {/* DONUT ON TOP — live */}
      <div className="card" style={{padding:0, overflow:'hidden'}}>
        <div style={{padding:14, paddingBottom:0}}>
          <div className="chart-wrap-head">
            <strong>Аналитика расходов</strong><small>{loading?'загрузка…':new Date().toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</small>
            <div style={{display:'flex',gap:6}}>
              <select className="select" style={{padding:'7px 10px',border:'1px solid #D8DDE5',borderRadius:10,background:'#fff',fontSize:12,fontWeight:600}} value={activeCat||'all'} onChange={e=>setActiveCat(e.target.value==='all'?null:e.target.value)}><option value="all">Все категории</option>{displayDonut.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </div>
          </div>
        </div>
        <div className="chart-wrap" style={{margin:0, border:0, borderRadius:0, borderTop:'1px solid var(--border)'}}>
          <div style={{display:'grid', gridTemplateColumns:'1.1fr 1fr', gap:16, alignItems:'center'}}>
            <div style={{display:'grid',placeItems:'center',position:'relative',cursor:'pointer'}} onClick={()=>setActiveCat(null)}>
              <DonutChart data={displayDonut} total={displayTotal} activeCat={activeCat} onSelect={setActiveCat} />
              <div style={{position:'absolute',textAlign:'center',pointerEvents:'none'}}>
                <div style={{fontSize:10,color:'var(--muted)',fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase'}}>Расходы</div>
                <div style={{fontSize:15,fontWeight:800,letterSpacing:'-.02em'}}>{donutCenter}</div>
                <div style={{fontSize:11,color:'var(--muted)',fontWeight:600}}>{donutSub}</div>
              </div>
            </div>
            <div>
              <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Топ-5 • тап — фильтр</div>
              {displayDonut.slice(0,5).map((c:any)=>{
                const pct=Math.round(c.amount/displayTotal*100)
                const isActive=activeCat===c.id
                return <div key={c.id} className="legend-item" onClick={()=>setActiveCat(isActive?null:c.id)} style={{display:'flex',alignItems:'center',gap:6,padding:'4px 6px',borderRadius:8,background:isActive?'var(--primary-soft)':'transparent',cursor:'pointer',border:isActive?'1px solid var(--primary-soft-b)':'1px solid transparent'}}>
                  <span className="legend-dot" style={{background:c.color,width:10,height:10,borderRadius:'50%',flex:'0 0 auto'}} />
                  <strong style={{fontSize:12}}>{c.name}</strong>
                  <span style={{marginLeft:'auto',color:'var(--muted)',fontSize:12}}>{rub(c.amount)} · {pct}%</span>
                </div>
              })}
              {displayDonut.find((c:any)=>c.id==='other') && <div className="legend-item" onClick={()=>setActiveCat(activeCat==='other'?null:'other')} style={{display:'flex',alignItems:'center',gap:6,padding:'4px 6px',borderRadius:8,background:activeCat==='other'?'var(--primary-soft)':'transparent',cursor:'pointer',marginTop:4}}><span className="legend-dot" style={{background:'#9CA3AF',width:10,height:10,borderRadius:'50%'}} />Остальные <span style={{marginLeft:'auto',color:'var(--muted)',fontSize:12}}>{rub(displayDonut.find((c:any)=>c.id==='other')!.amount)} · {Math.round(displayDonut.find((c:any)=>c.id==='other')!.amount/displayTotal*100)}%</span></div>}
            </div>
          </div>
          {activeCat && <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}><span className="pill live">● Фильтр: <b>{displayDonut.find((c:any)=>c.id===activeCat)?.name || displayRanked.find((c:any)=>c.id===activeCat)?.name}</b> <button onClick={()=>setActiveCat(null)} style={{border:0,background:'none',cursor:'pointer',fontWeight:700,color:'var(--primary)',marginLeft:4}}>✕ сброс</button></span><span className="pill">{displayRanked.find((c:any)=>c.id===activeCat)?.amount ? rub(displayRanked.find((c:any)=>c.id===activeCat)!.amount)+' • '+Math.round(displayRanked.find((c:any)=>c.id===activeCat)!.amount/displayTotal*100)+'%':''}</span></div>}
        </div>
        <div style={{padding:12, display:'flex', gap:8}}>
          <button className="button primary" style={{flex:1}} onClick={()=>openAdd('EXPENSE')}>＋ Расход</button>
          <button className="button secondary" style={{flex:1}} onClick={()=>openAdd('INCOME')}>＋ Доход</button>
          <button className="button ghost" style={{flex:1}} onClick={()=>p.setFTab('receipts')}>📷 Чек → N</button>
        </div>
      </div>

      {addModal && <div className="modal-backdrop" onClick={()=>setAddModal(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,.42)',backdropFilter:'blur(4px)',zIndex:40,display:'flex',alignItems:'flex-end'}} onMouseDown={e=>e.target===e.currentTarget&&setAddModal(null)}>
        <div className="modal-sheet" onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:640,margin:'0 auto',background:'#fff',borderRadius:'22px 22px 0 0',padding:'18px 16px calc(18px + env(safe-area-inset-bottom))',boxShadow:'0 -10px 30px rgba(0,0,0,.16)',maxHeight:'92vh',overflow:'auto'}}>
          <div className="modal-head" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <h2 style={{margin:0,fontSize:19,fontWeight:800,fontFamily:'Manrope'}}>{addModal.type==='EXPENSE'?'Новый расход':'Новый доход'}</h2>
            <button onClick={()=>setAddModal(null)} style={{border:0,background:'#F1F5F9',width:36,height:36,borderRadius:'50%',fontSize:20,cursor:'pointer',display:'grid',placeItems:'center'}}>×</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div>
              <label style={{fontSize:12,fontWeight:700,color:'var(--muted)'}}>Сумма, ₽</label>
              <input type="number" inputMode="decimal" placeholder="0" value={formAmount} onChange={e=>setFormAmount(e.target.value)} style={{width:'100%',border:'1px solid #D8DDE5',borderRadius:12,padding:'14px 12px',fontSize:20,fontWeight:800}} autoFocus />
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:700,color:'var(--muted)'}}>Категория</label>
              <select value={formCat} onChange={e=>setFormCat(e.target.value)} style={{width:'100%',border:'1px solid #D8DDE5',borderRadius:12,padding:'12px',background:'#fff',fontSize:14}}>
                <option value="">— выберите —</option>
                {(catList.length?catList:CATS).map((c:any)=><option key={c.id||c.name} value={c.name}>{c.icon?`${c.icon} `:''}{c.name}</option>)}
              </select>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                {(catList.length?catList.slice(0,8):CATS.filter(c=>c.amount>0).slice(0,8)).map((c:any)=><button key={c.id||c.name} onClick={()=>setFormCat(c.name)} style={{padding:'6px 10px',borderRadius:999,border: formCat===c.name?'1px solid var(--primary)':'1px solid var(--border)',background: formCat===c.name?'var(--primary-soft)':'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>{c.icon||'•'} {c.name}</button>)}
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div><label style={{fontSize:12,fontWeight:700,color:'var(--muted)'}}>Дата</label><input type="date" value={formDate} onChange={e=>setFormDate(e.target.value)} style={{width:'100%',border:'1px solid #D8DDE5',borderRadius:12,padding:'12px',background:'#fff'}}/></div>
              <div><label style={{fontSize:12,fontWeight:700,color:'var(--muted)'}}>Заметка</label><input placeholder="Магнит" value={formDesc} onChange={e=>setFormDesc(e.target.value)} style={{width:'100%',border:'1px solid #D8DDE5',borderRadius:12,padding:'12px'}}/></div>
            </div>
            <button className="button primary" disabled={savingTx} onClick={submitAdd} style={{width:'100%',padding:'14px',fontSize:15}}>{savingTx?'Сохранение…': addModal.type==='EXPENSE'?'Создать расход':'Создать доход'}</button>
            <p style={{fontSize:11,color:'var(--muted)',textAlign:'center',margin:0}}>Создаст транзакцию • POST /finances • попадёт в аналитику и тренд</p>
          </div>
        </div>
      </div>}

      {/* TREND on top — live */}
      <div className="card">
        <div className="chart-wrap-head"><strong>Динамика 6 месяцев</strong><small>тап по месяцу — drill-down {displayTrend?'• live':''}</small></div>
        <TrendLarge selectedMonth={selectedMonth} onSelect={setSelectedMonth} data={displayTrend||undefined} />
        <div className="note" style={{marginTop:10,padding:'10px 12px',background:'#F0FDFA',border:'1px solid #99F6E4',borderRadius:12,fontSize:12,lineHeight:1.5,color:'#115E59'}}>{trendNotes[selectedMonth]}</div>
        <div style={{display:'flex', gap:8, marginTop:12,flexWrap:'wrap'}}>
          <span className="pill" style={{borderColor:'#0F766E', color:'#0F766E'}}><span style={{display:'inline-block',width:8,height:8,background:'#0F766E',borderRadius:4,marginRight:6}}/>Доходы</span>
          <span className="pill" style={{borderColor:'#F59E0B', color:'#8A4A00'}}><span style={{display:'inline-block',width:8,height:8,background:'#F59E0B',borderRadius:4,marginRight:6}}/>Расходы</span>
          <span className="pill live">{selectedMonth==='sep'?'Сен':selectedMonth} — выбран</span>
        </div>
      </div>

      {/* RANKED LIST — details below */}
      <div className="card">
        <div className="card-head"><h3>Рейтинг категорий</h3><div style={{display:'flex',gap:6}}><button className={showLimits?'pill live':'pill'} onClick={()=>setShowLimits(!showLimits)} style={{cursor:'pointer',border:'1px solid var(--border)'}}>лимиты {showLimits?'●':''}</button></div></div>
        <div className="filter-row" style={{display:'flex',gap:8,overflow:'auto',padding:'4px 0',scrollbarWidth:'none'}}>
          {[
            ['all','Все'],
            ['over','Перерасход'],
            ['food','Еда'],
            ['home','Дом'],
          ].map(([k,l])=><button key={k} className={quickFilter===k?'filter-chip active':'filter-chip'} onClick={()=>setQuickFilter(k as any)} style={{whiteSpace:'nowrap',border:'1px solid var(--border)',background:quickFilter===k?'var(--primary)':'#fff',color:quickFilter===k?'#fff':'var(--text)',borderRadius:999,padding:'7px 12px',fontSize:12,fontWeight:600,cursor:'pointer'}}>{l}</button>)}
        </div>
        <div style={{marginTop:8}}>
          {visibleRanked.map(c=>{
            const pct = displayTotal ? Math.round(c.amount/displayTotal*100) : 0
            const isActive = activeCat===c.id
            const over = c.budget && c.amount>c.budget
            const limitPos = c.budget ? Math.min(100, Math.round(c.budget / (c.amount/ pct *100) *100)) : null
            return <div key={c.id} className="bar-row" onClick={()=>setActiveCat(isActive?null:c.id)} style={{padding:'11px 0',borderBottom:'1px solid #F1F1EF',cursor:'pointer',background:isActive?'var(--primary-soft-2)':'transparent',margin:'0 -14px',paddingLeft:14,paddingRight:14}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{width:10,height:10,borderRadius:'50%',background:c.color,flex:'0 0 auto'}} />
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}><strong style={{fontSize:13}}>{c.name}</strong>{over && <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:999,background:'#FFE4E6',color:'#9F1239',border:'1px solid #FECDD3'}}>! перерасход</span>}{c.amount>0 && pct>=5 && <span style={{fontSize:11,color:c.amount>c.budget?'#E11D48':'#8A94A6'}}>{pct>=10?'●':''}</span>}</div>
                    {c.budget ? <div style={{fontSize:11,color: over?'#E11D48':'#8A94A6'}}>{rub(c.amount)} / {rub(c.budget)} {over?'· '+Math.round(c.amount/c.budget*100)+'%':''}</div> : <div style={{fontSize:11,color:'#8A94A6'}}>{rub(c.amount)} • {pct}%</div>}
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontWeight:800,fontSize:13,whiteSpace:'nowrap'}}>{rub(c.amount)}</span>
                  <button onClick={(e)=>{e.stopPropagation(); openAdd('EXPENSE', c.id)}} title={`Добавить в ${c.name}`} style={{width:28,height:28,borderRadius:'50%',border:'1px solid var(--border)',background:'#fff',display:'grid',placeItems:'center',fontSize:16,lineHeight:1,cursor:'pointer',flex:'0 0 auto',boxShadow:'0 1px 4px rgba(0,0,0,.06)'}}>+</button>
                </div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginTop:4}}><span style={{fontSize:11,color:'var(--muted)'}}>{pct}% от расходов</span>{over && <span style={{fontSize:11,color:'#E11D48',fontWeight:700}}>лимит превышен</span>}</div>
              <div className="progress" style={{marginTop:6,position:'relative',height:8,background:'#EDF0F4',borderRadius:999,overflow:'hidden'}}><span style={{display:'block',height:'100%',width:`${Math.min(100,pct)}%`,background:c.color,borderRadius:999,opacity:isActive?1:.95}} />{showLimits && limitPos!==null && <span style={{position:'absolute',top:0,bottom:0,left:`${limitPos}%`,width:2,background:'#E11D48',opacity:.9}} />}</div>
            </div>
          })}
          {visibleRanked.length===0 && <div className="empty" style={{marginTop:10,padding:'18px',textAlign:'center',color:'var(--muted)',fontSize:13,border:'1px dashed var(--border)',borderRadius:12,background:'var(--surface-2)'}}>Нет категорий по фильтру</div>}
        </div>
        <button className="button secondary" style={{width:'100%',marginTop:12}} onClick={()=>setShowAll(!showAll)}>{showAll? 'Свернуть' : `Показать остальные ${Math.max(0,filteredRanked.length-8)}`}</button>
        {activeCat && <div style={{marginTop:12,padding:12,background:'#fff',border:'1px solid var(--border)',borderRadius:12}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><strong style={{fontSize:13}}>{displayRanked.find((c:any)=>c.id===activeCat)?.name || displayDonut.find((c:any)=>c.id===activeCat)?.name} — фильтр</strong><button onClick={()=>setActiveCat(null)} style={{border:0,background:'none',color:'var(--primary)',fontWeight:700,cursor:'pointer',fontSize:12}}>сброс ✕</button></div><div style={{fontSize:12,color:'var(--muted)',marginTop:4}}>{activeCatObj? `${rub(activeCatObj.amount)} • ${Math.round(activeCatObj.amount/displayTotal*100)}% ${activeCatObj.budget||activeCatObj.limit_amount?`• лимит ${rub(activeCatObj.budget||activeCatObj.limit_amount)}`:''}`:''}</div></div>}
        <div style={{display:'flex',gap:8,marginTop:10}}><span className="pill" style={{borderColor:'var(--primary)',color:'var(--primary)'}}>Тап по строке — фильтр</span><span className="pill" style={{borderColor:'#E9E6E1'}}>＋ — быстрый ввод</span></div>
        <p className="muted" style={{fontSize:11,margin:'6px 0 0',lineHeight:1.4}}>Аналитика как в современных apps: donut + бары. Кружки — во вкладке «Категории».</p>
      </div>
      <button onClick={()=>openAdd('EXPENSE')} title="Быстрый ввод" style={{position:'fixed', bottom:88, right:16, width:56, height:56, borderRadius:'50%', background:'var(--primary)', color:'#fff', border:0, boxShadow:'0 6px 20px rgba(15,118,110,.35)', fontSize:28, display:'grid', placeItems:'center', zIndex:15, cursor:'pointer'}}>+</button>
    </>}

    {p.fTab==='categories' && <>
      <div className="card">
        <div className="card-head"><h3>Все категории (20)</h3><span className="pill">названия из CoinKeeper • тап + для ввода</span></div>
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <input placeholder="Поиск категории…" style={{flex:1,border:'1px solid var(--border)',borderRadius:12,padding:'10px 12px',background:'#fff',fontSize:14}} onChange={e=>{ const v=e.target.value.toLowerCase(); const rows=document.querySelectorAll('#cat-list .bar-row'); rows.forEach((r:any)=>{ const name=r.dataset.name||''; r.style.display = name.includes(v)?'':'none' }) }} />
          <button className="button secondary small" onClick={()=>{ const v=prompt('Новая категория'); if(v) alert('Создать: '+v+' — POST /finance/categories')}}>＋ Категория</button>
        </div>
        <div id="cat-list">
        {displayRanked.map((c:any)=>{
          const pct = displayTotal ? Math.round(c.amount/displayTotal*100) : 0
          const isActive = activeCat===c.id
          const over = c.limit_amount ? c.amount>c.limit_amount : (c.budget && c.amount>c.budget)
          const limitVal = c.limit_amount || c.budget
          const limitPos = limitVal ? Math.min(100, Math.round(limitVal / (c.amount/ pct *100) *100)) : null
          return <div key={c.id} data-name={c.name.toLowerCase()} className="bar-row" onClick={()=>setActiveCat(isActive?null:c.id)} style={{padding:'12px 0',borderBottom:'1px solid #F1F1EF',cursor:'pointer',background:isActive?'var(--primary-soft-2)':'transparent',margin:'0 -14px',paddingLeft:14,paddingRight:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{width:32,height:32,borderRadius:10,background:c.color+'18',color:c.color,border:`1px solid ${c.color}30`,display:'grid',placeItems:'center',fontSize:16}}>{c.icon}</span>
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}><strong style={{fontSize:13.5}}>{c.name}</strong>{over && <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:999,background:'#FFE4E6',color:'#9F1239',border:'1px solid #FECDD3'}}>! перерасход</span>}</div>
                  <div style={{fontSize:12,color: over?'#E11D48':'var(--muted)'}}>{rub(c.amount)} • {pct}% {limitVal?`• лимит ${rub(limitVal)}`:''}</div>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontWeight:800,fontSize:13}}>{pct}%</span>
                <button onClick={(e)=>{e.stopPropagation(); openAdd('EXPENSE', c.id)}} title={`Добавить в ${c.name}`} style={{width:32,height:32,borderRadius:'50%',border:'1px solid var(--border)',background:'#fff',display:'grid',placeItems:'center',fontSize:18,lineHeight:1,cursor:'pointer',boxShadow:'0 1px 4px rgba(0,0,0,.06)'}}>+</button>
              </div>
            </div>
            <div className="progress" style={{marginTop:8,position:'relative',height:8,background:'#EDF0F4',borderRadius:999,overflow:'hidden'}}><span style={{display:'block',height:'100%',width:`${Math.min(100,pct)}%`,background:c.color,borderRadius:999,opacity:isActive?1:.9}} />{showLimits && limitPos!==null && <span style={{position:'absolute',top:0,bottom:0,left:`${limitPos}%`,width:2,background:'#E11D48',opacity:.9}} />}</div>
          </div>
        })}
        </div>
        <p className="muted" style={{fontSize:11,margin:'10px 0 0'}}>Современный список — как в Spendee/Bankure. Без кружков, с барами и лимитами. Названия зафиксированы.</p>
      </div>
    </>}

    {p.fTab==='receipts' && <ReceiptsTab items={p.receiptItems} setItems={p.setReceiptItems} show={p.showReceiptConfirm} setShow={p.setShowReceiptConfirm} onDataChanged={()=>setRefreshKey(k=>k+1)} />}

    {p.fTab==='stocks' && <StocksTab />}

    {p.fTab==='credits' && <CreditsTab />}

    {p.fTab==='budget' && <BudgetTab ranked={displayRanked} income={displayIncome} expense={displayTotal} />}
  </div>
}

function DonutChart(p:{data:Cat[]; total:number; activeCat?:string|null; onSelect?:(id:string)=>void}){
  const total = p.data.reduce((s,c)=>s+c.amount,0)
  let acc = 0
  const segs = p.data.map(c=>{
    const pct = total? c.amount/total : 0
    const start = acc
    acc += pct
    return { ...c, start, pct }
  })
  const r=52, circ=2*Math.PI*r
  return <div style={{display:'grid',placeItems:'center',position:'relative'}}>
    <svg width={140} height={140} viewBox="0 0 140 140" style={{transform:'rotate(-90deg)'}}>
      <circle cx={70} cy={70} r={r} fill="none" stroke="#F1F5F9" strokeWidth={18} />
      {segs.map(s=>{
        const len = circ * s.pct
        const offset = circ * s.start
        const isActive = p.activeCat===s.id
        const dim = p.activeCat && p.activeCat!==s.id
        return <circle key={s.id} cx={70} cy={70} r={r} fill="none" stroke={s.color} strokeWidth={isActive?20:18} strokeDasharray={`${len} ${circ-len}`} strokeDashoffset={-offset} strokeLinecap="round" style={{transition:'.2s',opacity: dim? .25:1,cursor:'pointer'}} onClick={()=>p.onSelect?.(s.id)} />
      })}
    </svg>
  </div>
}

function TrendLarge(p:{selectedMonth?:string; onSelect?:(m:string)=>void; data?:any[]}){
  const fallback = [
    {id:'apr', m:'Апр', income:120, expense:95},
    {id:'may', m:'Май', income:140, expense:110},
    {id:'jun', m:'Июн', income:165, expense:130},
    {id:'jul', m:'Июл', income:150, expense:145},
    {id:'aug', m:'Авг', income:180, expense:120},
    {id:'sep', m:'Сен', income:173, expense:159},
  ]
  // Map API trend (label, income, expense in rub) -> normalized 0-100 for height
  // API trend: [{label:'Апр', income:120000, expense:95000},...]
  let months: any[] = fallback
  let max = 180
  if(p.data && p.data.length){
    // Normalize to k₽ for bar height
    const toK = (v:number)=> Math.round(v/1000)
    months = p.data.map((d:any)=>({ id: d.label.toLowerCase().slice(0,3), m: d.label, income: toK(d.income), expense: toK(d.expense), raw: d }))
    max = Math.max(...months.flatMap(m=>[m.income,m.expense])) || 180
    if(max<10) max=180
  }
  const sel = p.selectedMonth || months[months.length-1]?.id || 'sep'
  return <div className="trend-bars" style={{display:'flex',gap:6,height:110,padding:'8px 0'}}>
    {months.map((x:any)=>{
      const active = sel===x.id
      return <div key={x.m} className="trend-col" onClick={()=>p.onSelect?.(x.id)} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4,cursor:'pointer',opacity: active?1:.9,outline: active?'2px solid var(--primary)':'none',outlineOffset: active?2:0,borderRadius:8,padding: active?'2px':0}}>
      <div style={{flex:1, display:'flex', gap:4, alignItems:'end', width:'100%', justifyContent:'center'}}>
        <div className="trend-bar income" style={{height:`${Math.max(4, x.income/max*100)}%`, width:14, background: active?'var(--primary)':'#0F766E', borderRadius:6}} title={`Доход ${x.income}k`} />
        <div className="trend-bar expense" style={{height:`${Math.max(4, x.expense/max*100)}%`, width:14, background: active?'#F59E0B':'#F59E0B', borderRadius:6}} title={`Расход ${x.expense}k`} />
      </div>
      <small style={{fontSize:10,color: active?'var(--primary)':'var(--muted)',fontWeight: active?700:600}}>{x.m}</small>
    </div>
    })}
  </div>
}
function MiniTrend(){
  const d=[40,55,70,62,85,78]
  return <svg viewBox="0 0 100 30" width="100%" height={36} style={{display:'block'}}>
    <polyline fill="none" stroke="#0F766E" strokeWidth={2} points={d.map((v,i)=>`${i*20},${30-v/3}`).join(' ')} strokeLinejoin="round" strokeLinecap="round" />
    <polyline fill="none" stroke="#F59E0B" strokeWidth={2} opacity={.9} points="0,22 20,18 40,15 60,20 80,12 100,10" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
}

function CategoryGridAll(p:{selected:string|null; onSelect:(id:string|null)=>void}){
  return <div className="category-grid">
    {CATS.map(c=>{
      const active = p.selected===c.id
      return <button key={c.id} className="cat-card" onClick={()=>p.onSelect(active?null:c.id)} style={{opacity: c.amount===0? .9 : 1}}>
        <div className="cat-icon" style={{background:c.color, boxShadow: active?`0 0 0 3px ${c.color}40, 0 6px 16px rgba(0,0,0,.12)`:'0 4px 12px rgba(0,0,0,.10)', transform: active? 'scale(1.05)':undefined}}>
          {c.icon}
          {c.amount>c.budget! && c.budget ? <span style={{position:'absolute',top:-4,right:-4,width:14,height:14,background:'#E11D48',borderRadius:'50%',border:'2px solid #fff',display:'grid',placeItems:'center',fontSize:8,color:'#fff'}}>!</span> : null}
        </div>
        <small style={{color: active? '#0F766E' : undefined, fontWeight: active? 800:600}}>{c.name}</small>
        <b style={{color:c.color}}>{c.amount? shortRub(c.amount): '0 ₽'}</b>
      </button>
    })}
  </div>
}
function CategoryGridRelevant(){
  const top = [...CATS].filter(c=>c.amount>0).sort((a,b)=>b.amount-a.amount).slice(0,8)
  return <div className="category-grid">
    {top.map(c=><div key={c.id} className="cat-card">
      <div className="cat-icon" style={{background:c.color}}>{c.icon}</div>
      <small>{c.name}</small>
      <b>{shortRub(c.amount)}</b>
    </div>)}
  </div>
}

// ---- RECEIPTS — live API with N-confirm ----
function ReceiptsTab(p:{items:any[]; setItems:(a:any[])=>void; show:boolean; setShow:(b:boolean)=>void; onDataChanged?:()=>void}){
  const [receipt,setReceipt]=useState<any>(null)
  const [receiptDate,setReceiptDate]=useState(new Date().toISOString().slice(0,10))
  const [merchant,setMerchant]=useState('')
  const [uploading,setUploading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [confirming,setConfirming]=useState(false)

  const total = p.items.reduce((s,it)=>s+it.price*it.qty,0)
  const update = (id:string, field:string, val:any)=> {
    const next=p.items.map(it=> it.id===id? {...it,[field]: val}:it)
    p.setItems(next)
    // autosave draft to API if receipt exists
    if(receipt?.id){
      setSaving(true)
      apiPatch(`/finance/receipts/${receipt.id}`, {
        merchant: merchant || undefined,
        total: next.reduce((s:any,it:any)=>s+it.price*it.qty,0),
        date: receiptDate,
        items: next.map((it:any)=>({ name: it.name, qty: it.qty, price: it.price, category: it.cat }))
      }).catch(e=>setError(String(e).slice(0,100))).finally(()=>setSaving(false))
    }
  }

  const onFile = async (f:File)=>{
    setUploading(true); setError(null)
    try{
      const b64 = await toBase64(f)
      const j = await apiPost('/finance/receipts', { file_name: f.name, mime_type: f.type || 'image/jpeg', image_data: b64 })
      const r = j.data
      setReceipt(r)
      // Populate items from review_payload or ai_result
      const payload = r.review_payload || r.ai_result?.parsed || r.ai_result?.review_payload
      setReceiptDate(payload?.date || payload?.occurred_on || new Date().toISOString().slice(0,10))
      setMerchant(payload?.merchant || '')
      if(payload?.items?.length){
        const mapped = payload.items.map((it:any,i:number)=>({ id: String(Date.now()+i), name: it.name||it.title||'Товар', qty: Number(it.qty||1), price: Number(it.price||0), cat: it.category||'Покупки' }))
        p.setItems(mapped)
      } else {
        p.setItems([])
      }
      p.setShow(true)
    }catch(e:any){
      setError(String(e.message||e).slice(0,150))
    }finally{setUploading(false)}
  }

  const onConfirm = async ()=>{
    if(!receipt?.id){
      setError('Сначала загрузите фотографию чека.');
      return
    }
    setConfirming(true); setError(null)
    try{
      const payload = { merchant: merchant||undefined, total, date: receiptDate, items: p.items.map(it=>({ name: it.name, qty: it.qty, price: it.price, category: it.cat })) }
      const j = await apiPost(`/finance/receipts/${receipt.id}/confirm`, payload)
      alert(`Подтверждено! Создано ${j.data.created_count} транзакций на ${rub(j.data.total_amount)} • receipt ${receipt.id} → CONFIRMED`)
      p.setShow(false)
      p.onDataChanged?.()
    }catch(e:any){
      setError(String(e.message||e).slice(0,150))
    }finally{setConfirming(false)}
  }

  return <div className="stack">
    <div className="card">
      <div className="chart-wrap" style={{marginBottom:12}}>
        <div className="chart-wrap-head"><strong>Фото чека → ИИ → подтверждение</strong><small>live API • N расходов</small></div>
        <div style={{display:'grid', gridTemplateColumns:'72px 1fr', gap:12, alignItems:'center'}}>
          <div style={{width:72,height:72,borderRadius:12,background:'#FFF7ED',border:'1px solid #FED7AA',display:'grid',placeItems:'center',fontSize:28}}>🧾</div>
          <div>
            <div style={{fontWeight:700}}>{receipt? `Чек ${receipt.id.slice(0,8)} • ${receipt.ocr_status}` : 'Загрузите фото чека'}</div>
            <div style={{fontSize:12,color:'var(--muted)'}}>{receipt? `Файл: ${receipt.file_name||'—'}` : 'ИИ распознает позиции, дату и суммы, если настроен ключ AI API.'}</div>
            <div className="pill live" style={{marginTop:6, display:'inline-flex'}}>● {receipt? receipt.ocr_status : 'Ожидает загрузки'} {saving?'• сохранение…':''}</div>
          </div>
        </div>
        {error && <div style={{marginTop:8,padding:'8px 10px',background:'#FFE4E6',border:'1px solid #FECDD3',borderRadius:10,fontSize:12,color:'#9F1239'}}>{error}</div>}
        <div style={{marginTop:12,display:'flex',gap:8}}>
          <label className="button primary" style={{flex:1,cursor:'pointer'}}>
            {uploading?'Загрузка…':'📷 Выбрать фото чека'}
            <input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{ const f=e.target.files?.[0]; if(f) onFile(f) }} />
          </label>
          <button className="button secondary" style={{flex:1}} onClick={()=>{ setReceipt(null); p.setShow(false) }}>Сброс</button>
        </div>
      </div>

      {!p.show ? <div className="muted">После загрузки чека здесь появятся распознанные позиции для проверки.</div> :
      <>
        <div className="card-head"><h3>Проверьте распознавание</h3><span className="pill" style={{background:'#FEF3C7', color:'#92400E', borderColor:'#FDE68A'}}>{receipt?.ocr_status||'ожидает'}</span></div>
        <div style={{display:'flex',gap:8,marginBottom:10}}><input placeholder="Магазин" value={merchant} onChange={e=>setMerchant(e.target.value)} /><label>Дата покупки<input type="date" value={receiptDate} onChange={e=>setReceiptDate(e.target.value)} /></label></div>
        <div style={{overflow:'auto', border:'1px solid var(--border)', borderRadius:12}}>
          <table className="receipt-table">
            <thead><tr><th>Товар</th><th>Кол</th><th>Цена</th><th>Категория</th><th></th></tr></thead>
            <tbody>
              {p.items.map(it=><tr key={it.id}>
                <td><input value={it.name} onChange={e=>update(it.id,'name',e.target.value)} style={{minWidth:120}} /></td>
                <td><input type="number" value={it.qty} onChange={e=>update(it.id,'qty',Number(e.target.value))} style={{width:56}} /></td>
                <td><input type="number" value={it.price} onChange={e=>update(it.id,'price',Number(e.target.value))} style={{width:90}} /></td>
                <td>
                  <select value={it.cat} onChange={e=>update(it.id,'cat',e.target.value)}>
                    {CATS.map(c=><option key={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td><button className="tiny danger" style={{borderColor:'#FECDD3'}} onClick={()=>p.setItems(p.items.filter(x=>x.id!==it.id))}>×</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div style={{display:'flex', gap:8, marginTop:12}}>
          <button className="button secondary" style={{flex:1}} onClick={()=>p.setItems([...p.items,{id:String(Date.now()), name:'Новый товар', qty:1, price:0, cat:'Покупки'}])}>＋ Позиция</button>
          <button className="button ghost" style={{flex:1}} onClick={()=>p.setShow(false)}>Отмена</button>
        </div>
        <div style={{marginTop:14, padding:14, background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:14, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div><div style={{fontSize:12,color:'var(--muted)'}}>Итого к созданию</div><div style={{fontSize:18,fontWeight:800}}>{rub(total)} • {p.items.length} трат</div></div>
          <div style={{fontSize:12, color: total>0 ? '#0D9A6E' : '#E11D48', fontWeight:700}}>{total>0?'совпадает ✓':'проверь суммы'}</div>
        </div>
        <button className="button primary full" style={{marginTop:12}} disabled={confirming||uploading} onClick={onConfirm}>{confirming?'Подтверждаю…':`Подтвердить • ${p.items.length} • ${rub(total)}`}</button>
      </>}
    </div>
  </div>
}

// ---- STOCKS ----
function StocksTab(){
  const items = [
    { name:'Туалетная бумага Zewa', icon:'🧻', bought:'02.10', days:20, left:3, stock:'9 / 12 рулонов', pct:75 },
    { name:'Шампунь Head&Shoulders', icon:'🧴', bought:'15.09', days:34, left:9, stock:'210 / 400 мл', pct:52 },
    { name:'Корм для кота', icon:'🐱', bought:'28.09', days:18, left:12, stock:'1.2 / 2 кг', pct:60 },
  ]
  return <div className="stack">
    <div className="card">
      <div className="chart-wrap" style={{marginBottom:0}}>
        <div className="chart-wrap-head"><strong>Прогноз расхода</strong><small>на сколько хватает</small></div>
        <div style={{height:120, display:'flex', alignItems:'end', gap:8, padding:'8px 0'}}>
          {items.map(it=><div key={it.name} style={{flex:1, textAlign:'center'}}>
            <div style={{height:80, background:'#F1F5F9', borderRadius:10, overflow:'hidden', display:'flex', alignItems:'end'}}>
              <div style={{height:`${it.pct}%`, background: it.left<=3? '#E11D48' : '#0F766E', width:'100%', transition:'.3s'}} />
            </div>
            <small style={{fontSize:10, color:'var(--muted)'}}>{it.left}дн</small>
          </div>)}
        </div>
        <div style={{display:'flex', gap:6, marginTop:8, flexWrap:'wrap'}}>
          {items.map(it=><span key={it.name} className="pill" style={{fontSize:11}}>{it.icon} {it.name.split(' ')[0]} · {it.left}дн</span>)}
        </div>
      </div>
    </div>

    <div className="card">
      <div className="card-head"><h3>Нужно докупить на неделе</h3><span className="pill" style={{background:'#FFE4E6', color:'#9F1239', borderColor:'#FECDD3'}}>3 товара</span></div>
      {items.filter(i=>i.left<=12).map(it=><div key={it.name} className="consumable-card">
        <div className="consumable-icon">{it.icon}</div>
        <div>
          <div style={{fontWeight:700,fontSize:13}}>{it.name}</div>
          <div className="meta"><small>Куплено {it.bought} • {it.stock} • хватит до {it.left} дн</small></div>
          <div className="progress" style={{marginTop:6}}><span style={{width:`${it.pct}%`, background: it.left<=3? '#E11D48':'#0F766E'}} /></div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:12,fontWeight:800, color: it.left<=3? '#E11D48':'#0F766E'}}>через {it.left} дн</div>
          <button className="button primary small" style={{marginTop:6}} onClick={()=>alert('Купил — тут POST /consumables/:id/purchases + пересчет прогноза')}>＋ Купил</button>
        </div>
      </div>)}
    </div>

    <div className="card">
      <div className="card-head"><h3>Все запасы</h3><button className="button primary small">＋ Товар</button></div>
      <p className="muted" style={{fontSize:12}}>Тут будут все регулярные товары. После 2 покупок показываем «хватает на N дней» по формуле <code>дней между покупками / кол-во</code>.</p>
    </div>
  </div>
}

// ---- LARGE ----
function LargeTab(p:{monthly:number; setMonthly:(n:number)=>void}){
  const [goals,setGoals]=useState<any[]>([
    { id:'1', name:'iPad для сына', target:80000, saved:12000, priority:1, icon:'📱' },
    { id:'2', name:'Пылесос Dyson', target:35000, saved:8000, priority:2, icon:'🧹' },
    { id:'3', name:'Поездка в Сочи', target:120000, saved:0, priority:3, icon:'✈️' },
  ])
  const [showAdd,setShowAdd]=useState<string|null>(null)
  const [amount,setAmount]=useState('')
  const [loading,setLoading]=useState(false)
  useEffect(()=>{ apiGet('/finance/goals').then(j=>{ if(j.data?.length) setGoals(j.data.map((g:any)=>({ id:g.id, name:g.name, target:parseFloat(g.target_amount), saved: (g.contributions||[]).reduce((s:any,c:any)=>s+parseFloat(c.amount),0), priority: g.priority==='HIGH'?1: g.priority==='MEDIUM'?2:3, icon:'🎯' }))) }).catch(()=>{}) },[])
  const addContribution = async (id:string)=>{
    const v=parseFloat(amount.replace(',','.'))
    if(!v||v<=0) return alert('Введите сумму')
    setLoading(true)
    try{ await apiPost(`/finance/goals/${id}/contributions`, {amount: v, contribution_date: new Date().toISOString().slice(0,10)}); setGoals(gs=>gs.map(g=> g.id===id? {...g, saved: g.saved+v}:g)); setShowAdd(null); setAmount('') }catch(e:any){ alert(String(e.message||e).slice(0,120)) }finally{ setLoading(false) }
  }
  return <div className="stack">
    <div className="card">
      <div className="chart-wrap" style={{marginBottom:0}}>
        <div className="chart-wrap-head"><strong>План накоплений</strong><small>ползунок — feasibility</small></div>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12}}>
          <div><div style={{fontSize:12,color:'var(--muted)'}}>В месяц</div><div style={{fontSize:22,fontWeight:800}}>{rub(p.monthly)}</div></div>
          <input type="range" min={2000} max={30000} step={1000} value={p.monthly} onChange={e=>p.setMonthly(Number(e.target.value))} className="plan-slider" style={{flex:1}} />
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginTop:12}}>
          {goals.map(g=>{
            const left = g.target-g.saved
            const months = Math.ceil(left/p.monthly)
            return <div key={g.id} style={{padding:10, background:'#F8FAFC', border:'1px solid var(--border)', borderRadius:12, textAlign:'center'}}>
              <div style={{fontSize:18}}>{g.icon}</div>
              <div style={{fontSize:11,fontWeight:700,marginTop:4}}>{g.name}</div>
              <div style={{fontSize:12,color:'var(--muted)'}}>{months} мес</div>
              <div style={{fontSize:11,color: months>12?'#E11D48':'#0F766E',fontWeight:700}}>{rub(left)}</div>
            </div>
          })}
        </div>
      </div>
    </div>
    {goals.map(g=>{
      const pct = Math.round(g.saved/g.target*100)
      const left = g.target-g.saved
      const months = Math.ceil(left/p.monthly)
      return <div key={g.id} className="card">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12}}>
          <div style={{display:'flex', gap:10, alignItems:'center'}}>
            <div className="priority-handle" style={{cursor:'grab'}}>☰</div>
            <div>
              <div style={{fontWeight:800, display:'flex', gap:6, alignItems:'center'}}><span>{g.icon}</span> {g.name} {g.priority===1 && <span className="pill live">★ Приоритет 1</span>}</div>
              <small className="muted">{rub(g.saved)} / {rub(g.target)} • осталось {rub(left)}</small>
            </div>
          </div>
          <div style={{textAlign:'right'}}><div style={{fontWeight:800}}>{pct}%</div><small style={{color:'var(--muted)'}}>{months} мес при {shortRub(p.monthly)}/мес</small></div>
        </div>
        <div className="progress" style={{marginTop:12}}><span style={{width:`${pct}%`}} /></div>
        {showAdd===g.id ? <div style={{marginTop:12,display:'flex',gap:8}}>
          <input type="number" placeholder="Сумма" value={amount} onChange={e=>setAmount(e.target.value)} style={{flex:1,border:'1px solid var(--border)',borderRadius:10,padding:'10px 12px'}} autoFocus />
          <button className="button primary" disabled={loading} onClick={()=>addContribution(g.id)}>{loading?'...':'Внести'}</button>
          <button className="button secondary" onClick={()=>setShowAdd(null)}>Отмена</button>
        </div> : <div style={{display:'flex', gap:8, marginTop:12}}>
          <button className="button primary" style={{flex:1}} onClick={()=>setShowAdd(g.id)}>＋ Внести</button>
          <button className="button ghost" style={{flex:1}} onClick={()=>{ const v=prompt('Новая цена'); if(v) apiPost(`/finance/goals/${g.id}/prices`,{price:parseFloat(v),recorded_at:new Date().toISOString()}).then(()=>alert('Цена обновлена')).catch(e=>alert(String(e).slice(0,80))) }}>Цена</button>
        </div>}
      </div>
    })}
  </div>
}

// ---- CREDITS — live ----
function CreditsTab(){
  const [credits,setCredits]=useState<any[]>([]);const [date,setDate]=useState(new Date().toISOString().slice(0,10));const [sum,setSum]=useState('');const [mode,setMode]=useState<'TERM'|'PAYMENT'>('TERM');const [saving,setSaving]=useState(false);const [error,setError]=useState('')
  const [selectedCredit,setSelectedCredit]=useState('')
  const refresh=()=>apiGet('/credits').then(j=>setCredits(j.data||[])).catch(e=>setError(String(e.message||e).slice(0,140)))
  useEffect(()=>{refresh()},[])
  useEffect(()=>{if(!selectedCredit&&credits[0])setSelectedCredit(credits[0].id)},[credits,selectedCredit])
  const submit=async()=>{const credit=credits.find(c=>c.id===selectedCredit)||credits[0];if(!credit){setError('Сначала добавьте кредит.');return}const amount=Number(sum);if(!amount||amount<=0){setError('Введите положительную сумму.');return}setSaving(true);setError('');try{await apiPost(`/credits/${credit.id}/prepayments`,{amount,paid_on:date,recalculation_mode:mode});setSum('');await refresh()}catch(e:any){setError(String(e.message||e).slice(0,160))}finally{setSaving(false)}}
  const updateMode=async(id:string,value:'TERM'|'PAYMENT')=>{try{await apiPatch(`/credit-prepayments/${id}`,{recalculation_mode:value});await refresh()}catch(e:any){setError(String(e.message||e).slice(0,140))}}
  const credit=credits.find(c=>c.id===selectedCredit)||credits[0]
  return <div className="stack"><div className="card"><div className="card-head"><h3>Кредиты семьи</h3><button className="button secondary small" onClick={refresh}>Обновить</button></div>{error&&<p style={{color:'#B91C1C'}}>{error}</p>}
    {credits.length?<div style={{overflowX:'auto'}}><table className="receipt-table"><thead><tr><th>Кредит</th><th>Сумма</th><th>Ставка</th><th>Ежемесячный платёж</th><th>Срок</th></tr></thead><tbody>{credits.map(c=><tr key={c.id}><td>{c.name||'Кредит'}</td><td>{rub(Number(c.principal))}</td><td>{Number(c.annual_rate)}%</td><td>{rub(Number(c.standard_payment))}</td><td>{Number(c.term_months)} мес.</td></tr>)}</tbody></table></div>:<p className="muted">Кредиты пока не добавлены.</p>}
    {credit&&<div className="grid-3" style={{marginTop:12}}><div className="metric"><small>Сумма кредита</small><strong>{rub(Number(credit.principal))}</strong></div><div className="metric"><small>Первый платёж</small><strong>{new Date(credit.first_payment_date).toLocaleDateString('ru-RU')}</strong></div><div className="metric"><small>Стратегия по умолчанию</small><strong>{credit.recalculation_mode==='TERM'?'Срок':'Платёж'}</strong></div></div>}
  </div>
  <div className="card"><div className="card-head"><h3>Досрочное погашение</h3><span className="pill">Исторические даты доступны</span></div><div className="form-grid">{credits.length>1&&<select className="wide" value={selectedCredit} onChange={e=>setSelectedCredit(e.target.value)}>{credits.map(c=><option key={c.id} value={c.id}>{c.name||'Кредит'}</option>)}</select>}<label>Дата платежа<input type="date" max={new Date().toISOString().slice(0,10)} value={date} onChange={e=>setDate(e.target.value)} /></label><input type="number" min="0.01" placeholder="Сумма" value={sum} onChange={e=>setSum(e.target.value)} /><select className="wide" value={mode} onChange={e=>setMode(e.target.value as any)}><option value="TERM">Направить на уменьшение срока</option><option value="PAYMENT">Направить на уменьшение платежа</option></select></div><button className="button primary full" style={{marginTop:10}} disabled={saving||!credit} onClick={submit}>{saving?'Сохраняю…':'Добавить досрочный платёж'}</button>
  </div>
  {credit&&<div className="card"><div className="card-head"><h3>Досрочные платежи</h3><span className="pill">{credit.prepayments?.length||0}</span></div>{credit.prepayments?.length?credit.prepayments.map((pre:any)=><div className="list-item-card" key={pre.id}><b>{new Date(pre.paid_on).toLocaleDateString('ru-RU')}</b><strong>{rub(Number(pre.amount))}</strong><label style={{marginLeft:'auto'}}>Пересчёт<select value={pre.recalculation_mode||credit.recalculation_mode} onChange={e=>updateMode(pre.id,e.target.value as any)}><option value="TERM">Срок</option><option value="PAYMENT">Платёж</option></select></label></div>):<p className="muted">Досрочных платежей пока нет.</p>}</div>}
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

function ListsV07(){
  const [items,setItems]=useState<any[]>([]);const [type,setType]=useState<'LARGE'|'RECURRING'>('LARGE');const [show,setShow]=useState(false);const [name,setName]=useState('');const [category,setCategory]=useState('');const [amount,setAmount]=useState('');const [due,setDue]=useState('');const [cadence,setCadence]=useState('3');const [error,setError]=useState('')
  const refresh=()=>apiGet('/planned-purchases').then(j=>setItems(j.data||[])).catch(e=>setError(String(e.message||e).slice(0,140)))
  useEffect(()=>{refresh()},[])
  const add=async()=>{try{setError('');await apiPost('/planned-purchases',{type,name,category:category||undefined,estimated_amount:amount?Number(amount):undefined,due_date:due||undefined,cadence_months:type==='RECURRING'?Number(cadence):undefined,notify_days_before:7});setName('');setCategory('');setAmount('');setDue('');setShow(false);await refresh()}catch(e:any){setError(String(e.message||e).slice(0,150))}}
  const mark=async(id:string)=>{try{await apiPost(`/planned-purchases/${id}/purchased`,{purchased_on:new Date().toISOString().slice(0,10)});await refresh()}catch(e:any){setError(String(e.message||e).slice(0,120))}}
  const shown=items.filter(x=>x.type===type)
  return <div className="stack"><SectionTitle title="Планируемые покупки" subtitle="Общий семейный план крупных и регулярных покупок." action={<button className="button primary small" onClick={()=>setShow(!show)}>＋ Добавить</button>} />{error&&<div className="card" style={{color:'#B91C1C'}}>{error}</div>}
    <div className="segmented"><button className={type==='LARGE'?'active':''} onClick={()=>setType('LARGE')}>Крупные покупки и подарки</button><button className={type==='RECURRING'?'active':''} onClick={()=>setType('RECURRING')}>Регулярные покупки</button></div>
    {show&&<div className="card"><h3>{type==='LARGE'?'Добавить покупку или подарок':'Добавить регулярную покупку'}</h3><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><input placeholder="Название" value={name} onChange={e=>setName(e.target.value)} /><input placeholder="Категория" value={category} onChange={e=>setCategory(e.target.value)} /><input type="number" min="0" placeholder="Сумма, ₽" value={amount} onChange={e=>setAmount(e.target.value)} /><label>Ориентировочная дата<input type="date" value={due} onChange={e=>setDue(e.target.value)} /></label>{type==='RECURRING'&&<label>Периодичность, месяцев<input type="number" min="1" max="120" value={cadence} onChange={e=>setCadence(e.target.value)} /></label>}</div><div style={{display:'flex',gap:8,marginTop:12}}><button className="button primary" onClick={add}>Сохранить</button><button className="button secondary" onClick={()=>setShow(false)}>Отмена</button></div></div>}
    <div className="card"><div className="card-head"><h3>{type==='LARGE'?'Крупные покупки и подарки':'Регулярные покупки'}</h3><span className="pill">{shown.length}</span></div>{shown.length?shown.map(x=><div className="list-item-card" key={x.id}><div style={{flex:1}}><strong>{x.name}</strong><small style={{display:'block',color:'var(--muted)'}}>{x.category||'Без категории'}{x.cadence_months?` · каждые ${x.cadence_months} мес.`:''} · добавил(а): {x.creator?.first_name||x.creator?.username||'участник'}</small></div><b>{x.estimated_amount?rub(Number(x.estimated_amount)):'Сумма не задана'}</b><span>{x.due_date||'Дата не задана'}</span>{type==='RECURRING'&&<button className="button secondary small" onClick={()=>mark(x.id)}>Купили</button>}</div>):<p className="muted">Список пока пуст. Добавьте первую позицию.</p>}</div>
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
  const [inviteTarget,setInviteTarget]=useState('')
  const [inviteName,setInviteName]=useState('')
  const [newFamilyName,setNewFamilyName]=useState('')
  const [familyName,setFamilyName]=useState('')
  const [editingName,setEditingName]=useState(false)
  const [confirmMember,setConfirmMember]=useState<any>(null)
  const [confirmInvitation,setConfirmInvitation]=useState<any>(null)
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
    try{await apiPost(`/family/invitations/${invitation.id}/accept`,{});await refresh();setNotice('Вы присоединились к семье. Общие разделы теперь доступны.')}
    catch(e:any){setError(String(e.message||e).slice(0,180))}finally{setBusy('')}
  }
  const createFamily=async()=>{
    const name=newFamilyName.trim()
    if(!name){setError('Введите название семьи.');return}
    setBusy('create');setError('')
    try{await apiPost('/families',{name});setNewFamilyName('');await refresh()}
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
  const initials=(member:any)=>`${member.user?.first_name?.[0]||''}${member.user?.last_name?.[0]||''}`.toUpperCase()||'👤'
  if(loading&&!family&&!error)return <div className="stack"><SectionTitle title="Семья" subtitle="Загружаем семейное пространство…"/><div className="card family-loading">Загружаем участников и приглашения…</div></div>
  if(!loaded&&!family)return <div className="stack"><SectionTitle title="Семья" subtitle="Не удалось загрузить семейное пространство."/><div className="family-alert" role="alert">{error}</div><button className="button secondary" onClick={refresh}>Попробовать ещё раз</button></div>
  if(!family)return <div className="stack family-page"><SectionTitle title="Семья" subtitle="Примите приглашение близких или создайте своё семейное пространство." action={<button className="button secondary family-refresh" onClick={refresh} disabled={loading} aria-label="Обновить приглашения">↻ <span>Обновить</span></button>}/>{error&&<div className="family-alert" role="alert">{error}</div>}{invitations.length>0&&<section className="card family-incoming"><h3>Вас приглашают в семью</h3>{invitations.map(inv=><article className="family-invitation" key={inv.id}><div className="family-member-info"><strong>{inv.family?.name||'Семья'}</strong><span>Приглашает {inv.inviter?.first_name||inv.inviter?.username||'администратор семьи'}{inv.expires_at?` · до ${new Date(inv.expires_at).toLocaleDateString('ru-RU')}`:''}</span></div><button className="button primary" disabled={!!busy||loading} onClick={()=>acceptInvitation(inv)}>{busy===inv.id?'Присоединяемся…':'Принять приглашение'}</button></article>)}</section>}<div className="card family-create"><div className="family-hero-icon">👨‍👩‍👧</div><h3>{invitations.length?'Или создайте свою семью':'Создайте семью'}</h3><p>После создания вы сможете пригласить близких и вести общие дела.</p><label>Название семьи<input value={newFamilyName} onChange={e=>setNewFamilyName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createFamily()} placeholder="Например, Семья Зубаревых" maxLength={120}/></label><button className="button primary full" disabled={!!busy||loading} onClick={createFamily}>{busy==='create'?'Создаём…':'Создать семейное пространство'}</button></div></div>
  return <div className="stack family-page">
    <SectionTitle title="Семья" subtitle="Участники, приглашения и общий доступ" action={<button className="button secondary family-refresh" onClick={refresh} disabled={loading} aria-label="Обновить состав семьи">↻ <span>Обновить</span></button>} />
    {error&&<div className="family-alert" role="alert">{error}</div>}
    {notice&&<div className="family-notice" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Закрыть уведомление">×</button></div>}
    <section className="card family-overview" aria-label="Информация о семье">
      <div className="family-overview-main"><div className="family-hero-icon">👨‍👩‍👧</div><div className="family-title-block">{editingName&&isAdmin?<><label className="family-name-edit"><span className="sr-only">Название семьи</span><input value={familyName} maxLength={120} onChange={e=>setFamilyName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveFamilyName()}/></label><div className="family-inline-actions"><button className="button primary small" onClick={saveFamilyName} disabled={busy==='name'}>{busy==='name'?'Сохраняю…':'Сохранить'}</button><button className="button secondary small" onClick={()=>{setFamilyName(family.name);setEditingName(false)}}>Отмена</button></div></>:<><h3>{family.name}</h3><p>Общее пространство семьи</p></>}</div>{isAdmin&&!editingName&&<button className="tiny family-edit-button" onClick={()=>setEditingName(true)}>Изменить название</button>}</div>
      <div className="family-summary"><div><strong>{family.members?.length||0}</strong><span>участников</span></div><div><strong>{invitations.length}</strong><span>ожидают приглашения</span></div><div><strong>{isAdmin?'Администратор':'Участник'}</strong><span>ваша роль</span></div></div>
    </section>
    <div className="family-columns">
      <section className="card family-members-card"><div className="card-head"><div><h3>Участники семьи</h3><small>Общие разделы доступны участникам</small></div>{isAdmin&&<button className="button primary small" onClick={()=>setShowInvite(v=>!v)}>{showInvite?'Закрыть':'＋ Пригласить'}</button>}</div>
        {showInvite&&isAdmin&&<div className="family-invite-form"><div className="family-form-title"><strong>Пригласить участника</strong><span>Приглашение появится у него в Family Hub</span></div><label>Telegram ID или логин<input value={inviteTarget} onChange={e=>setInviteTarget(e.target.value)} placeholder="Например, @username или 123456789" autoComplete="off"/></label><label>Имя для приглашения <span className="muted">(необязательно)</span><input value={inviteName} onChange={e=>setInviteName(e.target.value)} placeholder="Имя участника" maxLength={255}/></label><button className="button primary full" onClick={invite} disabled={busy==='invite'}>{busy==='invite'?'Создаём…':'Создать приглашение'}</button></div>}
        <div className="family-member-list">{family.members?.map((m:any)=><article className="family-member" key={m.id}><div className="family-avatar">{m.user?.avatar_url?<img src={m.user.avatar_url} alt=""/>:initials(m)}</div><div className="family-member-info"><strong>{m.user?.first_name||m.user?.username||'Участник'}</strong><span>{m.user?.username?`@${String(m.user.username).replace(/^@/,'')}`:'Участник семьи'}{m.joined_at?` · с ${new Date(m.joined_at).toLocaleDateString('ru-RU',{month:'short',year:'numeric'})}`:''}</span></div><span className={`family-role ${m.role==='ADMIN'?'admin':''}`}>{m.role==='ADMIN'?'Администратор':'Участник'}</span>{isAdmin&&m.id!==family.current_member_id&&<details className="family-member-menu"><summary aria-label={`Действия для ${m.user?.first_name||'участника'}`}>•••</summary><div className="family-member-actions"><label>Роль<select value={m.role} disabled={busy===m.id} onChange={e=>changeRole(m,e.target.value as 'ADMIN'|'USER')}><option value="USER">Участник</option><option value="ADMIN">Администратор</option></select></label><button className="tiny danger" onClick={()=>setConfirmMember(m)}>Удалить из семьи</button></div></details>}</article>)}{!family.members?.length&&<div className="empty">Пока в семье только вы. Пригласите близких.</div>}</div>
      </section>
      <section className="card family-access-card"><div className="card-head"><div><h3>Общий доступ</h3><small>Что доступно участникам семьи</small></div><span className="family-shared-icon">⌂</span></div><div className="family-access-list"><div><span>▦</span><div><strong>Календарь и напоминания</strong><small>Семейные события видны всем</small></div></div><div><span>☷</span><div><strong>Покупки и списки</strong><small>Общие планы и регулярные товары</small></div></div><div><span>₽</span><div><strong>Бюджет и кредиты</strong><small>Финансы семьи в одном месте</small></div></div></div><div className="family-access-note">Изменения в общих разделах сразу видны участникам с доступом к семье.</div></section>
    </div>
    {isAdmin&&<section className="card family-invitations-card"><div className="card-head"><div><h3>Приглашения</h3><small>Действуют 14 дней с момента создания</small></div><span className="pill">{invitations.length}</span></div>{invitations.length?invitations.map((inv:any)=><div className="family-invitation" key={inv.id}><div className="family-invite-avatar">✉</div><div className="family-member-info"><strong>{inv.first_name||(inv.username?`@${String(inv.username).replace(/^@/,'')}`:`Telegram ID ${inv.telegram_user_id}`)}</strong><span>{inv.username?`@${String(inv.username).replace(/^@/,'')} · `:''}Ожидает ответа{inv.expires_at?` · до ${new Date(inv.expires_at).toLocaleDateString('ru-RU')}`:''}</span></div><span className="family-pending">Ожидает</span><div className="family-invitation-actions"><button className="tiny" onClick={()=>copyInvitation(inv)}>Копировать приглашение</button><button className="tiny danger" disabled={busy===inv.id} onClick={()=>setConfirmInvitation(inv)}>{busy===inv.id?'…':'Отменить'}</button></div></div>):<div className="empty">Активных приглашений нет. Пригласите участника семьи.</div>}</section>}
    {confirmMember&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>e.target===e.currentTarget&&setConfirmMember(null)}><section className="modal-sheet family-confirm" role="dialog" aria-modal="true" aria-labelledby="family-remove-title"><div className="modal-head"><h2 id="family-remove-title">Удалить участника?</h2><button onClick={()=>setConfirmMember(null)} aria-label="Закрыть">×</button></div><p>Участник <strong>{confirmMember.user?.first_name||confirmMember.user?.username||'семьи'}</strong> потеряет доступ к общему пространству. Его данные семьи сохранятся.</p><div className="modal-actions"><button className="button secondary" onClick={()=>setConfirmMember(null)}>Оставить</button><button className="button primary family-danger-button" disabled={busy===confirmMember.id} onClick={removeMember}>{busy===confirmMember.id?'Удаляем…':'Удалить участника'}</button></div></section></div>}
    {confirmInvitation&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>e.target===e.currentTarget&&setConfirmInvitation(null)}><section className="modal-sheet family-confirm" role="dialog" aria-modal="true" aria-labelledby="family-invite-cancel-title"><div className="modal-head"><h2 id="family-invite-cancel-title">Отменить приглашение?</h2><button onClick={()=>setConfirmInvitation(null)} aria-label="Закрыть">×</button></div><p>Приглашение для <strong>{confirmInvitation.first_name||confirmInvitation.username||`Telegram ID ${confirmInvitation.telegram_user_id}`}</strong> перестанет действовать.</p><div className="modal-actions"><button className="button secondary" onClick={()=>setConfirmInvitation(null)}>Оставить</button><button className="button primary family-danger-button" disabled={busy===confirmInvitation.id} onClick={()=>cancelInvitation(confirmInvitation)}>{busy===confirmInvitation.id?'Отменяем…':'Отменить приглашение'}</button></div></section></div>}
  </div>
}
function BudgetTab(p:{ranked:any[]; income:number; expense:number}){
  const max=Math.max(1,p.income,p.expense)
  const categoryMax=Math.max(1,...p.ranked.map(c=>Number(c.amount)||0))
  return <div className="stack">
    <div className="card"><div className="card-head"><h3>Доходы и расходы</h3><span className="pill">{p.expense>p.income?'Расходы выше доходов':'В пределах дохода'}</span></div>
      <div className="summary-line"><span>Доход</span><strong style={{color:'#0F766E'}}>{rub(p.income)}</strong></div><div className="progress"><span style={{width:`${Math.max(2,p.income/max*100)}%`,background:'#0F766E'}} /></div>
      <div className="summary-line"><span>Расход</span><strong style={{color:p.expense>p.income?'#E11D48':'#334155'}}>{rub(p.expense)}</strong></div><div className="progress"><span style={{width:`${Math.max(2,p.expense/max*100)}%`,background:p.expense>p.income?'#E11D48':'#F59E0B'}} /></div>
      <p className="muted">Остаток за выбранный период: {rub(p.income-p.expense)}. Данные обновляются после внесения операции или подтверждения чека.</p>
    </div>
    <div className="card"><div className="card-head"><h3>Расходы по категориям</h3></div>{p.ranked.length?p.ranked.slice(0,10).map(c=><div key={c.id||c.name} style={{marginTop:10}}><div className="summary-line"><span>{c.name}</span><strong>{rub(Number(c.amount)||0)}</strong></div><div className="progress"><span style={{width:`${Math.max(2,(Number(c.amount)||0)/categoryMax*100)}%`,background:c.color||'#0F766E'}} /></div></div>):<p className="muted">За этот период расходов пока нет.</p>}</div>
  </div>
}
function SectionTitle(p:{title:string; subtitle?:string; action?:any}){
  return <div className="section-title"><div><h2>{p.title}</h2>{p.subtitle && <p>{p.subtitle}</p>}</div>{p.action}</div>
}
