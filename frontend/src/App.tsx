import { useEffect, useMemo, useState } from 'react'
import './styles.v07.css'

// ---- API helpers (Telegram auth + local dev fallback) ----
function getAuthHeaders(): Record<string,string> {
  const h: Record<string,string> = { 'Content-Type': 'application/json' }
  const tg = (window as any).Telegram?.WebApp
  if (tg?.initData) h['X-Telegram-Init-Data'] = tg.initData
  else {
    const devId = (typeof localStorage !== 'undefined' && localStorage.getItem('dev_telegram_id')) || '999001'
    h['X-Dev-Telegram-User-Id'] = devId
  }
  return h
}
async function apiGet(path:string){
  const r = await fetch(`/api/v1${path}`, { headers: getAuthHeaders() })
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
async function apiPost(path:string, body:any){
  const r = await fetch(`/api/v1${path}`, { method:'POST', headers: getAuthHeaders(), body: JSON.stringify(body) })
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
async function apiPatch(path:string, body:any){
  const r = await fetch(`/api/v1${path}`, { method:'PATCH', headers: getAuthHeaders(), body: JSON.stringify(body) })
  if(!r.ok) throw new Error(await r.text())
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
  const [section,setSection]=useState<Section>('finance')
  const [fTab,setFTab]=useState<FinanceTab>('overview')
  const [selectedCat,setSelectedCat]=useState<string|null>(null)
  const [receiptItems,setReceiptItems]=useState([
    { id:'1', name:'Молоко 1л', qty:1, price:89, cat:'Продукты' },
    { id:'2', name:'Хлеб Бородинский', qty:1, price:45, cat:'Продукты' },
    { id:'3', name:'Сыр 200г', qty:1, price:210, cat:'Продукты' },
  ])
  const [showReceiptConfirm,setShowReceiptConfirm]=useState(true)
  const [monthlyPlan,setMonthlyPlan]=useState(10000)

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
        <div className="eyebrow">Семья • Москва • Teal v07</div>
        <h1>Family Hub</h1>
      </div>
      <div className="topbar-right">
        <span className="badge-pill">Demo v07</span>
        <div className="user-badge">М</div>
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
      <Nav active={section==='lists'} label="Списки" icon="☷" onClick={()=>setSection('lists')} />
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

// ---------- HOME ----------
function HomeView(p:{onGo:(s:Section)=>void; totalExpense:number}){
  return <div className="stack">
    <SectionTitle title="Сегодня" subtitle="Сентябрь 2026 • графики вверху, детали ниже — как ты просила" />
    <div className="grid-2">
      <div className="card">
        <div className="kicker">Быстрый старт</div>
        <h3 style={{margin:'0 0 10px',fontSize:16}}>Семейный хаб v07</h3>
        <p className="muted" style={{fontSize:13,lineHeight:1.5}}>Нажми «Финансы» → увидишь CoinKeeper-кружки, кольцевую диаграмму и живой чек с редактированием.</p>
        <button className="button primary full" style={{marginTop:12}} onClick={()=>p.onGo('finance')}>Открыть финансы →</button>
      </div>
      <div className="card">
        <div className="kicker">Баланс семьи</div>
        <div className="grid-3" style={{gap:8}}>
          <div className="metric balance"><small>Баланс</small><strong style={{color:'#0F766E'}}>+10 527 ₽</strong></div>
          <div className="metric"><small>Расходы</small><strong>{shortRub(p.totalExpense)}</strong></div>
          <div className="metric"><small>В планах</small><strong>24 956 ₽</strong></div>
        </div>
        <div className="chart-wrap" style={{marginTop:12,marginBottom:0,padding:12}}>
          <div className="chart-wrap-head"><strong>Тренд 6 мес</strong><small>доходы vs расходы</small></div>
          <MiniTrend />
        </div>
      </div>
    </div>
  </div>
}

// ---------- FINANCE — MODERN ANALYSIS (Teal, approved 24.09) ----------
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
    const year=2026, month=9
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

  const displayTotal: number = apiData?.total_expense ?? p.totalExpense
  const displayIncome: number = apiData?.total_income ?? 173571
  const displayBalance: number = apiData?.balance ?? (displayIncome - displayTotal)
  // api ranked already has icon/color/amount/percent/limit
  const displayRanked: any[] = apiData?.ranked ?? p.ranked.map((c:any)=>({ ...c, percent: displayTotal? Math.round(c.amount/displayTotal*100):0 }))
  const displayDonut: any[] = apiData?.donut ?? p.donutData
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
        ['large','Крупные'],
        ['credits','Кредиты'],
        ['budget','Бюджет'],
      ].map(([k,l])=><button key={k} className={p.fTab===k?'finance-tab active':'finance-tab'} onClick={()=>p.setFTab(k as FinanceTab)}>{l}</button>)}
    </div>

    {p.fTab==='overview' && <>
      {/* TOP METRICS — live from API */}
      <div className="grid-3">
        <div className="metric"><small>Доходы</small><strong style={{color:'#0D9A6E'}}>{rub(displayIncome)}</strong><small style={{fontSize:11}}>Работа + кешбэк {loading?'• загрузка…':''}</small></div>
        <div className="metric"><small>Расходы</small><strong style={{color:'#E11D48'}}>{rub(displayTotal)}</strong><small style={{fontSize:11}}>{displayRanked.length} категорий {apiError?'• мок':''}</small></div>
        <div className="metric balance"><small>Баланс</small><strong style={{color: displayBalance>=0?'#0F766E':'#E11D48'}}>{(displayBalance>=0?'+':'')+rub(displayBalance)}</strong><small style={{fontSize:11, color:'#0F766E'}}>{displayIncome? Math.round(displayBalance/displayIncome*100)+'% от доходов':''}</small></div>
      </div>
      {apiError && <div style={{padding:'8px 10px',background:'#FFE4E6',border:'1px solid #FECDD3',borderRadius:10,fontSize:12,color:'#9F1239'}}>API недоступен — показываю мок. {apiError.slice(0,80)}</div>}

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
            <strong>Аналитика расходов</strong><small>{loading?'загрузка…':'сентябрь 2026 • графики вверху'}</small>
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
            const pct = p.totalExpense ? Math.round(c.amount/p.totalExpense*100) : 0
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
      <div className="card" style={{padding:0}}>
        <div style={{padding:16}} className="chart-wrap-head"><strong>Все категории (20)</strong><small>тап по кружку — сразу ввод</small></div>
        <div style={{padding:'0 12px 16px'}}>
          <CategoryGridAll selected={p.selectedCat} onSelect={(id)=>{ if(id) openAdd('EXPENSE', id); p.setSelectedCat(id) }} />
        </div>
        <div style={{padding:'10px 16px', background:'var(--surface-2)', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)', textAlign:'center'}}>Нажми кружок — откроется ввод с этой категорией • названия из CoinKeeper зафиксированы</div>
      </div>

      <div className="card">
        <div className="chart-wrap-head"><strong>Ранжирование трат</strong><small>по убыванию — тот же список</small></div>
        {[...CATS].sort((a,b)=>b.amount-a.amount).map(c=>{
          const pct = p.totalExpense ? Math.round(c.amount/p.totalExpense*100) : 0
          return <div key={c.id} className="bar-row" style={{padding:'11px 0',borderBottom:'1px solid #F1F1EF'}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{width:28,height:28,borderRadius:'50%',background:c.color,color:'#fff',display:'grid',placeItems:'center',fontSize:14}}>{c.icon}</span>
                <div>
                  <strong style={{fontSize:13}}>{c.name}</strong>
                  {c.budget && <div style={{fontSize:11,color: c.amount>c.budget?'#E11D48':'#8A94A6'}}>{rub(c.amount)} / {rub(c.budget)} {c.amount>c.budget?'· перерасход!':''}</div>}
                </div>
              </div>
              <span style={{fontWeight:700}}>{pct}%</span>
            </div>
            <div className="progress" style={{height:8,background:'#EDF0F4',borderRadius:999,overflow:'hidden',marginTop:6}}><span style={{display:'block',height:'100%',width:`${Math.min(100,pct)}%`, background:c.color,borderRadius:999}} /></div>
          </div>
        })}
      </div>
    </>}

    {p.fTab==='receipts' && <ReceiptsTab items={p.receiptItems} setItems={p.setReceiptItems} show={p.showReceiptConfirm} setShow={p.setShowReceiptConfirm} />}

    {p.fTab==='stocks' && <StocksTab />}

    {p.fTab==='large' && <LargeTab monthly={p.monthlyPlan} setMonthly={p.setMonthlyPlan} />}

    {p.fTab==='credits' && <CreditsTab />}

    {p.fTab==='budget' && <BudgetTab ranked={p.ranked} />}
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
function ReceiptsTab(p:{items:any[]; setItems:(a:any[])=>void; show:boolean; setShow:(b:boolean)=>void}){
  const [receipt,setReceipt]=useState<any>(null)
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
        merchant: receipt.merchant || 'Магнит',
        total: next.reduce((s:any,it:any)=>s+it.price*it.qty,0),
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
      if(payload?.items?.length){
        const mapped = payload.items.map((it:any,i:number)=>({ id: String(Date.now()+i), name: it.name||it.title||'Товар', qty: Number(it.qty||1), price: Number(it.price||0), cat: it.category||'Продукты' }))
        p.setItems(mapped)
      }
      p.setShow(true)
    }catch(e:any){
      setError(String(e.message||e).slice(0,150))
      // fallback: show mock
      p.setShow(true)
    }finally{setUploading(false)}
  }

  const onConfirm = async ()=>{
    if(!receipt?.id){
      // mock confirm
      alert(`Мок: создано ${p.items.length} транзакций на ${rub(total)} — без бэка. Загрузите фото для реального POST /receipts/{id}/confirm`)
      return
    }
    setConfirming(true); setError(null)
    try{
      const payload = { merchant: receipt.merchant||'Магнит', total, date: new Date().toISOString().slice(0,10), items: p.items.map(it=>({ name: it.name, qty: it.qty, price: it.price, category: it.cat })) }
      const j = await apiPost(`/finance/receipts/${receipt.id}/confirm`, payload)
      alert(`Подтверждено! Создано ${j.data.created_count} транзакций на ${rub(j.data.total_amount)} • receipt ${receipt.id} → CONFIRMED`)
      p.setShow(false)
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
            <div style={{fontWeight:700}}>{receipt? `Чек ${receipt.id.slice(0,8)} • ${receipt.ocr_status}` : 'Магнит • 12.09.2026 • демо'}</div>
            <div style={{fontSize:12,color:'var(--muted)'}}>{receipt? `Файл: ${receipt.file_name||'—'} • review_payload ${receipt.review_payload?'готово':'—'}` : 'AI распознает 3 позиции • уверенность 92% (мок)'}</div>
            <div className="pill live" style={{marginTop:6, display:'inline-flex'}}>● {receipt? receipt.ocr_status : 'PENDING → REVIEW'} {saving?'• сохранение…':''}</div>
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

      {!p.show ? <button className="button primary full" onClick={()=>p.setShow(true)}>📷 Открыть демо-таблицу (мок)</button> :
      <>
        <div className="card-head"><h3>Проверь распознавание</h3><span className="pill" style={{background:'#FEF3C7', color:'#92400E', borderColor:'#FDE68A'}}>{receipt?'live — можно редактировать':'мок — можно редактировать'}</span></div>
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
          <button className="button secondary" style={{flex:1}} onClick={()=>p.setItems([...p.items,{id:String(Date.now()), name:'Новый товар', qty:1, price:0, cat:'Продукты'}])}>＋ Позиция</button>
          <button className="button ghost" style={{flex:1}} onClick={()=>p.setShow(false)}>Отмена</button>
        </div>
        <div style={{marginTop:14, padding:14, background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:14, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div><div style={{fontSize:12,color:'var(--muted)'}}>Итого к созданию</div><div style={{fontSize:18,fontWeight:800}}>{rub(total)} • {p.items.length} трат</div></div>
          <div style={{fontSize:12, color: total>0 ? '#0D9A6E' : '#E11D48', fontWeight:700}}>{total>0?'совпадает ✓':'проверь суммы'}</div>
        </div>
        <button className="button primary full" style={{marginTop:12}} disabled={confirming||uploading} onClick={onConfirm}>{confirming?'Подтверждаю…':`Подтвердить и создать ${p.items.length} расхода${receipt?' • live':''}`}</button>
        <p className="muted" style={{fontSize:12, textAlign:'center', margin:'8px 0 0'}}>Создаст N транзакций по категориям — {receipt?`POST /receipts/${receipt.id.slice(0,8)}/confirm`:'мок, загрузите фото для live'}</p>
      </>}
    </div>

    <div className="card">
      <div className="kicker">Как это будет работать</div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, textAlign:'center'}}>
        {[
          ['📷','Фото','Камера → сжатие → POST /receipts'],
          ['🤖','ИИ','tesseract + OpenAI vision → черновик'],
          ['✅','Ты','Редактируешь → Confirm → N трат'],
        ].map(([ico,title,desc])=><div key={title} style={{padding:12, background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:12}}>
          <div style={{fontSize:22}}>{ico}</div><div style={{fontWeight:700,fontSize:12,marginTop:4}}>{title}</div><div style={{fontSize:11,color:'var(--muted)',lineHeight:1.3}}>{desc}</div>
        </div>)}
      </div>
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
  const goals = [
    { name:'iPad для сына', target:80000, saved:12000, priority:1, icon:'📱' },
    { name:'Пылесос Dyson', target:35000, saved:8000, priority:2, icon:'🧹' },
    { name:'Поездка в Сочи', target:120000, saved:0, priority:3, icon:'✈️' },
  ]
  return <div className="stack">
    <div className="card">
      <div className="chart-wrap" style={{marginBottom:12}}>
        <div className="chart-wrap-head"><strong>План накоплений</strong><small>сколько откладывать</small></div>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12}}>
          <div>
            <div style={{fontSize:12,color:'var(--muted)'}}>Откладывать в месяц</div>
            <div style={{fontSize:22,fontWeight:800}}>{rub(p.monthly)}</div>
          </div>
          <input type="range" min={2000} max={30000} step={1000} value={p.monthly} onChange={e=>p.setMonthly(Number(e.target.value))} className="plan-slider" style={{flex:1}} />
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginTop:12}}>
          {goals.map(g=>{
            const left = g.target-g.saved
            const months = Math.ceil(left/p.monthly)
            return <div key={g.name} style={{padding:10, background:'#F8FAFC', border:'1px solid var(--border)', borderRadius:12, textAlign:'center'}}>
              <div style={{fontSize:18}}>{g.icon}</div>
              <div style={{fontSize:11,fontWeight:700,marginTop:4}}>{g.name}</div>
              <div style={{fontSize:12,color:'var(--muted)'}}>{months} мес</div>
              <div style={{fontSize:11,color:'#0F766E',fontWeight:700}}>{rub(left)} left</div>
            </div>
          })}
        </div>
      </div>
    </div>

    {goals.map(g=>{
      const pct = Math.round(g.saved/g.target*100)
      const left = g.target-g.saved
      const months = Math.ceil(left/p.monthly)
      return <div key={g.name} className="card">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12}}>
          <div style={{display:'flex', gap:10, alignItems:'center'}}>
            <div className="priority-handle">☰</div>
            <div>
              <div style={{fontWeight:800, display:'flex', gap:6, alignItems:'center'}}><span>{g.icon}</span> {g.name} {g.priority===1 && <span className="pill live">★ Приоритет 1</span>}</div>
              <small className="muted">{rub(g.saved)} / {rub(g.target)} · осталось {rub(left)}</small>
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontWeight:800}}>{pct}%</div>
            <small style={{color:'var(--muted)'}}>{months} мес при {shortRub(p.monthly)}/мес</small>
          </div>
        </div>
        <div className="progress" style={{marginTop:12}}><span style={{width:`${pct}%`}} /></div>
        <div style={{display:'flex', gap:8, marginTop:12}}>
          <button className="button secondary" style={{flex:1}} onClick={()=>alert('Внести — POST /finance/goals/:id/contributions')}>＋ Внести</button>
          <button className="button ghost" style={{flex:1}}>Цена</button>
        </div>
      </div>
    })}
  </div>
}

// ---- CREDITS ----
function CreditsTab(){
  const schedule = [
    {m:1, amount:12340}, {m:2, amount:12340}, {m:3, amount:12340}, {m:4, amount:12100}, {m:5, amount:11800}
  ]
  return <div className="stack">
    <div className="card">
      <div className="chart-wrap">
        <div className="chart-wrap-head"><strong>Остаток долга</strong><small>ипотека · 3.5% · 240 мес</small></div>
        <svg viewBox="0 0 300 90" width="100%" height={90} style={{display:'block'}}>
          <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0F766E" stopOpacity={.25}/><stop offset="100%" stopColor="#0F766E" stopOpacity={0}/></linearGradient></defs>
          <path d="M0,70 L40,60 L80,52 L120,40 L160,28 L200,18 L240,10 L300,6 L300,90 L0,90 Z" fill="url(#g)" />
          <polyline fill="none" stroke="#0F766E" strokeWidth={2.5} points="0,70 40,60 80,52 120,40 160,28 200,18 240,10 300,6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <div style={{display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--muted)'}}><span>Сейчас 2.4M ₽</span><span>Через 5 лет 1.1M ₽</span></div>
      </div>
      <div className="credit-summary">
        <div><small>Остаток</small><strong>2 400 000 ₽</strong></div>
        <div><small>Ставка</small><strong>3.5%</strong></div>
        <div><small>Платеж</small><strong>12 340 ₽</strong></div>
      </div>
      <div style={{display:'flex', gap:8}}>
        <div className="pill live">TERM · уменьшить срок</div>
        <div className="pill">PAYMENT · уменьшить платеж</div>
      </div>
    </div>

    <div className="card">
      <div className="card-head"><h3>Досрочное погашение</h3><span className="pill">банковский график</span></div>
      <div className="form-grid">
        <input type="date" defaultValue="2026-10-15" />
        <input type="number" placeholder="Сумма" defaultValue={50000} />
        <select className="wide"><option>Уменьшить срок (TERM)</option><option>Уменьшить платеж (PAYMENT)</option></select>
      </div>
      <button className="button primary full" style={{marginTop:10}} onClick={()=>alert('Добавит досрочку и пересчитает хвост графика — POST /credits/:id/prepayments')}>Добавить досрочку → пересчитать график</button>
      <p className="muted" style={{fontSize:12,marginTop:8}}>График из банка хранится как есть, досрочки пересчитывают только будущие платежи. Можно менять тип досрочки и удалять.</p>
    </div>

    <div className="card">
      <div className="card-head"><h3>График платежей</h3><button className="button secondary small">Показать ещё</button></div>
      {schedule.map(r=><div key={r.m} className="credit-row"><span>Месяц {r.m}</span><strong>{rub(r.amount)}</strong></div>)}
      <div style={{marginTop:10, padding:10, background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:12, fontSize:12}}>
        💡 После досрочки 50 000 ₽ платёж {rub(12340)} → срок -6 мес (если TERM) или платёж 11 800 ₽ (если PAYMENT)
      </div>
    </div>
  </div>
}

// ---- CALENDAR ----
function CalendarV07(){
  const [vis,setVis]=useState<'all'|'my'|'family'>('all')
  return <div className="stack">
    <SectionTitle title="Календарь" subtitle="Общий + личный слой • графики вверху" action={<div style={{display:'flex',gap:6}}><button className="button primary small">＋ Событие</button><button className="button secondary small">＋ Напоминание</button></div>} />
    <div className="segmented" style={{marginBottom:0}}>
      <button className={vis==='all'?'active':''} onClick={()=>setVis('all')}>Все</button>
      <button className={vis==='my'?'active':''} onClick={()=>setVis('my')}>Мои 🔒</button>
      <button className={vis==='family'?'active':''} onClick={()=>setVis('family')}>Семья 👥</button>
    </div>

    <div className="card">
      <div className="chart-wrap" style={{marginBottom:12}}>
        <div className="chart-wrap-head"><strong>Загруженность недели</strong><small>сентябрь 2026</small></div>
        <div style={{display:'flex', gap:6, alignItems:'end', height:70}}>
          {[2,4,1,5,3,2,0].map((v,i)=><div key={i} style={{flex:1, background: i===3? '#0F766E':'#CBD5E1', height:`${v*14+8}px`, borderRadius:8, opacity: v===0? .3:1}} />)}
        </div>
        <div style={{display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--muted)', marginTop:6}}><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div>
      </div>

      <div className="card-head"><h3>Сентябрь 2026</h3><div style={{display:'flex',gap:6}}><span className="pill live">👥 Семья</span><span className="pill">🔒 Только я</span></div></div>
      <div className="calendar-grid">
        {Array.from({length:30},(_,i)=>{
          const day=i+1
          const isToday=day===24
          const hasEvent=[5,12,24].includes(day)
          return <div key={day} className={`cal-day ${isToday?'today':''}`}>
            <b>{day}</b>
            {hasEvent && <div style={{display:'flex',gap:3}}><span className="cal-dot" />{day===24 && <span className="cal-dot" style={{background:'#F59E0B'}} />}</div>}
            {hasEvent && <small style={{fontSize:8,lineHeight:1.1, color:'var(--muted)'}}>{day===5?'Врач 14:00':day===12?'Тренировка':'Посылка'}</small>}
          </div>
        })}
      </div>
      <div style={{marginTop:12, display:'flex', gap:8}}>
        <span className="pill"><span style={{width:8,height:8,background:'#0F766E',borderRadius:4,display:'inline-block',marginRight:6}}/>Событие семьи</span>
        <span className="pill"><span style={{width:8,height:8,background:'#F59E0B',borderRadius:4,display:'inline-block',marginRight:6}}/>Личное</span>
      </div>
    </div>

    <div className="card">
      <div className="card-head"><h3>Ближайшие</h3><small>Москва · Europe/Moscow</small></div>
      <div className="calendar-row" style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:4,padding:'12px 0',borderBottom:'1px solid #F1F1EF'}}>
        <strong>Врач 14:00–15:00 • 👥 Семья</strong><small>05.09 • Поликлиника • Отвечает папа</small><small style={{color:'#0F766E'}}>Повторяется: FREQ=WEEKLY — в тесте строкой ок</small>
      </div>
      <div style={{padding:'12px 0',borderBottom:'1px solid #F1F1EF'}}>
        <strong>Забрать посылку • 🔒 Только я</strong><small style={{display:'block', color:'var(--muted)', fontSize:12}}>12.09 • 18:00 • видит только создатель (решение 1-Б)</small>
      </div>
    </div>
  </div>
}

function ListsV07(){
  return <div className="stack">
    <SectionTitle title="Списки" subtitle="Общие семейные списки" />
    <div className="list-switcher"><button className="chip active">Продукты</button><button className="chip">Для дома</button><button className="chip">Аптечка</button></div>
    <div className="card">
      <div className="card-head"><h3>Продукты</h3><span className="pill">4 пункта</span></div>
      <div style={{display:'flex',flexDirection:'column'}}>
        {['Молоко','Хлеб','Яйца 10шт'].map(t=><div key={t} className="list-item-card"><button className="checkbox" />{t}<button className="tiny">✎</button></div>)}
        <div className="list-item-card"><button className="checkbox checked">✓</button><span className="done">Бананы</span><button className="tiny danger">×</button></div>
      </div>
      <button className="button primary full" style={{marginTop:12}}>＋ Добавить пункт</button>
    </div>
  </div>
}
function FamilyV07(){
  return <div className="stack">
    <SectionTitle title="Семья" subtitle="Участники и приглашения" />
    <div className="card"><div className="member-row"><div><strong>Мария</strong><small>@maria · Админ</small></div><span className="role-badge">Админ</span></div><div className="member-row"><div><strong>Папа</strong><small>Telegram ID</small></div><span className="role-badge" style={{background:'#EEF2F7',color:'var(--muted)',borderColor:'#E5E7EB'}}>Участник</span></div></div>
  </div>
}
function BudgetTab(p:{ranked:Cat[]}){
  return <div className="card">
    <div className="chart-wrap">
      <div className="chart-wrap-head"><strong>Бюджет сентября</strong><small>лимит vs факт</small></div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'end', gap:4, height:90}}>
        {p.ranked.slice(0,5).map(c=>{
          const pct = c.budget ? Math.min(100, c.amount/c.budget*100) : 0
          return <div key={c.id} style={{flex:1, textAlign:'center'}}>
            <div style={{height:70, background:'#F1F5F9', borderRadius:10, overflow:'hidden', display:'flex', alignItems:'end'}}>
              <div style={{height:`${pct}%`, background: pct>90? '#E11D48':'#0F766E', width:'100%'}} />
            </div>
            <small style={{fontSize:9, color:'var(--muted)'}}>{c.name.slice(0,6)}</small>
          </div>
        })}
      </div>
    </div>
    <div className="summary-line"><span>Лимит месяца</span><strong>60 000 ₽</strong></div>
    <div className="summary-line"><span>Потрачено</span><strong style={{color:'#E11D48'}}>42 187 ₽</strong></div>
    <div className="progress"><span style={{width:'70%', background:'#0F766E'}} /></div>
  </div>
}
function SectionTitle(p:{title:string; subtitle?:string; action?:any}){
  return <div className="section-title"><div><h2>{p.title}</h2>{p.subtitle && <p>{p.subtitle}</p>}</div>{p.action}</div>
}
