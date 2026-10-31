import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import './finance.css'
import CashbackScreen from './CashbackScreen'
import PersonalFinanceScreen, {SavingsFamilyHistory} from './PersonalFinanceScreen'
import CreditTools, {CreditActionIcon} from './CreditTools'

type Kind = 'EXPENSE' | 'INCOME'
type Tab = 'overview' | 'income' | 'categories' | 'receipts' | 'credits' | 'budget' | 'cashback'
type Category = { id:string; name:string; transaction_type:Kind; icon?:string; color?:string }
type Item = { name:string; qty:number; price:number; category:string; category_id?:string; needs_review?:boolean; category_needs_review?:boolean }
const money = (value:unknown) => `${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits:2 })} ₽`
const today = () => new Date().toLocaleDateString('sv-SE')
const dateLabel = (value:string) => value ? new Date(value.slice(0,10)+'T12:00:00').toLocaleDateString('ru-RU') : '—'
const authorName = (creator?:{first_name?:string;last_name?:string;username?:string}|null) => [creator?.first_name,creator?.last_name].filter(Boolean).join(' ').trim() || (creator?.username?'@'+creator.username:'Не указан')
const tabs: [Tab,string][] = [['overview','Обзор'],['income','Доходы'],['categories','Категории'],['receipts','Чеки'],['credits','Кредиты'],['budget','Бюджет'],['cashback','Кешбэк']]
const inPeriod = (date:string,period:string) => {
  if(period==='all')return true
  const d=new Date(date.slice(0,10)+'T12:00:00'),n=new Date(),start=new Date(n.getFullYear(),period==='year'?0:n.getMonth()-(period==='3m'?2:period==='6m'?5:0),1)
  return d>=start&&d<=new Date(n.getFullYear(),n.getMonth()+1,0,23,59,59)
}
const errorText = (error:unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.'
export async function request(path:string, method='GET', body?:unknown) {
  const headers:Record<string,string> = { 'Content-Type':'application/json', Accept:'application/json' }
  const initData = (window as any).Telegram?.WebApp?.initData
  if (initData) headers['X-Telegram-Init-Data'] = initData
  else headers['X-Dev-Telegram-User-Id'] = localStorage.getItem('dev_telegram_id') || '999001'
  let response:Response
  try { response = await fetch('/api/v1'+path, { method, headers, body:body===undefined?undefined:JSON.stringify(body) }) }
  catch { throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.') }
  const json = await response.json().catch(()=>null)
  if (!response.ok) {
    if (response.status===401) throw new Error('Откройте приложение заново через Telegram.')
    if (response.status===403) throw new Error(json?.code==='SECTION_HIDDEN'?'Администратор ограничил доступ к этому разделу.':'Для этого действия нужны права администратора семьи.')
    if (response.status===413) throw new Error('Фото слишком большое. Выберите изображение меньшего размера.')
    if (response.status===429) throw new Error('Слишком много запросов. Подождите минуту и попробуйте ещё раз.')
    if (response.status>=500) throw new Error('Сервер временно недоступен. Попробуйте ещё раз позже.')
    const message = Object.values(json?.errors || {}).flat()[0] || json?.message
    if (typeof message==='string' && /[а-яё]/i.test(message) && !/SQLSTATE|Exception|<|>/.test(message)) throw new Error(message)
    if (response.status===422) throw new Error('Проверьте обязательные поля, суммы и даты. Данные пока не сохранены.')
    if (response.status===409) throw new Error('Эта запись уже сохранена. Обновите список.')
    throw new Error('Не удалось выполнить действие. Попробуйте ещё раз.')
  }
  return json || { data:null }
}
export function Help({text,label='Подсказка'}:{text:string;label?:string}) {
  const [open,setOpen]=useState(false)
  const id=useId()
  const ref=useRef<HTMLSpanElement>(null)
  const [position,setPosition]=useState({left:0,width:240})
  useLayoutEffect(()=>{
    if(!open)return
    const place=()=>{
      const anchor=ref.current?.getBoundingClientRect()
      if(!anchor)return
      const width=Math.min(240,window.innerWidth-24)
      const left=Math.max(12,Math.min(anchor.left+anchor.width/2-width/2,window.innerWidth-width-12))
      setPosition({left:left-anchor.left,width})
    }
    place();window.addEventListener('resize',place)
    return()=>window.removeEventListener('resize',place)
  },[open])
  useEffect(()=>{
    if(!open)return
    const outside=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false)}
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)}
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[open])
  return <span className="f-help" ref={ref}><button type="button" className="f-help-button" aria-label={label} aria-expanded={open} aria-describedby={open?id:undefined} onClick={()=>setOpen(v=>!v)}>?</button>{open&&<span id={id} role="tooltip" className="f-tooltip" style={position}>{text}</span>}</span>
}
function ActionSymbol({title}:{title:string}) {
  const kind=title.startsWith('Удалить')?'delete':title.startsWith('Категория')?'category':title.includes('доход')?'income':title.includes('расход')?'expense':title.includes('кредит')?'credit':title.includes('бюджет')?'budget':title.includes('покупку')?'shopping':(title.includes('событие')||title.includes('встреча'))?'calendar':title.includes('напоминание')?'reminder':'receipt'
  const paths:Record<string,string>={calendar:'M4 5h14v14H4V5Z M8 3v4 M14 3v4 M4 9h14 M8 12h2 M12 15h2',reminder:'M5 15h12l-2-3V8a4 4 0 0 0-8 0v4l-2 3Z M9 18h4',shopping:'M4 7h14v12H4V7Z M8 7V5a3 3 0 0 1 6 0v2',income:'M16 5 6 15 M6 6v9h9',expense:'M5 16 15 6 M6 6h9v9',category:'M3 4h7l8 8-6 6-9-9V4Z M7 7h.01',credit:'M3 5h16v12H3V5Z M3 9h16 M6 13h4',budget:'M3 6h15v12H3V6Z M3 6V4h12 M14 10h6v5h-6v-5Z',receipt:'M5 3h12v16l-3-2-3 2-3-2-3 2V3Z M8 7h6 M8 11h6',delete:'M4 6h14 M8 6V3h6v3 M6 6l1 13h8l1-13 M10 9v7 M13 9v7'}
  return <span className={`f-action-symbol f-action-symbol-${kind}`} aria-hidden="true"><svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]}/></svg></span>
}
export function Modal({title,onClose,busy,children}:{title:string;onClose:()=>void;busy?:boolean;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null), id=useId()
  useEffect(()=>{
    const d=ref.current!,previousFocus=document.activeElement as HTMLElement|null
    d.showModal()
    d.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled),textarea:not(:disabled),select:not(:disabled)')?.focus({preventScroll:true})
    return()=>{d.close();window.requestAnimationFrame(()=>{if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true})})}
  },[])
  return <dialog className="finance-dialog" ref={ref} aria-label={title} onCancel={e=>{e.preventDefault();e.stopPropagation();if(!busy)onClose()}} onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}><section><div className="f-head"><div className="f-dialog-identity"><ActionSymbol title={title}/><h2 id={id}>{title}</h2></div><button type="button" className="f-icon" onClick={onClose} disabled={busy} aria-label="Закрыть">×</button></div>{children}</section></dialog>
}
function Message({text,error=false}:{text:string;error?:boolean}) { return text?<div className={error?'f-message f-error':'f-message'} role={error?'alert':'status'}>{text}</div>:null }
function Empty({children}:{children:ReactNode}) { return <p className="f-empty">{children}</p> }
function Head({title,children}:{title:string;children?:ReactNode}) {return <div className="f-head"><h3>{title}</h3>{children}</div>}
export function Field({label,children}:{label:string;children:ReactNode}) {return <label className="f-field"><span>{label}</span>{children}</label>}

function CategorySelect({categories,type='EXPENSE',admin,value,onSelect,onCreated,required,disabled,label}:{categories:Category[];type?:Kind;admin:boolean;value:string;onSelect:(category:Category)=>void;onCreated:(category:Category)=>void;required?:boolean;disabled?:boolean;label?:string}) {
  const [creating,setCreating]=useState(false),[name,setName]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  const create=async(e:FormEvent)=>{
    // A portal keeps this form outside the transaction/budget form in the DOM;
    // stop React event propagation too so creating a category never submits its parent.
    e.preventDefault();e.stopPropagation();if(saving)return
    if(!name.trim()){setError('Введите название категории.');return}
    setSaving(true);setError('')
    try{const j=await request('/finance/categories','POST',{name:name.trim(),transaction_type:type});onCreated(j.data);onSelect(j.data);setCreating(false)}catch(e){setError(errorText(e))}finally{setSaving(false)}
  }
  return <><select aria-label={label||'Категория'} required={required} disabled={disabled} value={value} onChange={e=>{if(e.target.value==='__new__'){setName('');setError('');setCreating(true)}else{const c=categories.find(c=>c.id===e.target.value);if(c)onSelect(c)}}}>{admin&&<option value="__new__">＋ Добавить новую категорию</option>}<option value="" disabled>Выберите категорию</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
    {creating&&createPortal(<Modal title={type==='INCOME'?'Категория дохода':'Категория расхода'} onClose={()=>setCreating(false)} busy={saving}><form className="f-form" onSubmit={create}><div className="f-form-fields"><Field label="Название"><input required maxLength={80} placeholder="Введите название" value={name} onChange={e=>setName(e.target.value)} autoFocus/></Field></div><Message text={error} error/><button className="button primary" disabled={saving||!name.trim()}>{saving?'Сохраняем…':'Создать категорию'}</button></form></Modal>,document.body)}
  </>
}

export default function FinanceScreen({initialExpense=false,onInitialExpenseConsumed,initialTab='overview',initialReceiptFile,onReceiptConsumed,initialCashbackFiles,onCashbackConsumed}:{initialExpense?:boolean;onInitialExpenseConsumed?:()=>void;initialTab?:Tab;initialReceiptFile?:File|null;onReceiptConsumed?:()=>void;initialCashbackFiles?:File[]|null;onCashbackConsumed?:()=>void}) {
  const [tab,setTab]=useState<Tab>(initialTab), [kind,setKind]=useState<Kind>('EXPENSE')
  const [period,setPeriod]=useState('month'), [categories,setCategories]=useState<Category[]>([])
  const [incomePeriod,setIncomePeriod]=useState('all'),[incomeLimit,setIncomeLimit]=useState(20)
  const [analytics,setAnalytics]=useState<any>(null), [transactions,setTransactions]=useState<any[]>([])
  const [admin,setAdmin]=useState(false), [scope,setScope]=useState<'family'|'personal'>('family')
  const [error,setError]=useState(''), [notice,setNotice]=useState(''), [loading,setLoading]=useState(true)
  const [tx,setTx]=useState<null|{type:Kind;category?:string}>(null), [addingCategory,setAddingCategory]=useState(false)
  const [categoryName,setCategoryName]=useState(''), [categoryError,setCategoryError]=useState(''), [saving,setSaving]=useState(false)
  const [search,setSearch]=useState(''), [selected,setSelected]=useState<string|null>(null)
  const refresh=async()=>{
    setLoading(true);setError('')
    const now=new Date()
    try {
      const [c,a,t,m]=await Promise.all([request('/finance/categories'),request(`/finance/analytics?period=${period}&year=${now.getFullYear()}&month=${now.getMonth()+1}`),request('/finances'),request('/me')])
      setCategories(c.data||[]);setAnalytics(a.data);setTransactions(t.data||[]);setAdmin(m.data?.family?.role==='ADMIN')
    } catch(e) {setError(errorText(e))} finally {setLoading(false)}
  }
  useEffect(()=>{void refresh()},[period])
  useEffect(()=>{if(initialExpense&&!loading&&!error){setTx({type:'EXPENSE'});onInitialExpenseConsumed?.()}},[initialExpense,loading,error])
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),7000);return()=>clearTimeout(t)},[notice])
  const done=(text:string)=>{setNotice(text);void refresh()}
  const rememberCategory=(category:Category)=>setCategories(rows=>[...rows.filter(c=>c.id!==category.id),category].sort((a,b)=>a.name.localeCompare(b.name,'ru')))
  const rows=categories.filter(c=>(c.transaction_type||'EXPENSE')===kind && c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const ranked:any[]=analytics?.ranked||[]
  const income=Number(analytics?.total_income)||0, expense=Number(analytics?.total_expense)||0
  const incomeRows=transactions.filter(t=>t.type==='INCOME'&&inPeriod(t.occurred_on,incomePeriod))
  const createCategory=async(e:FormEvent)=>{
    e.preventDefault();if(saving)return;setSaving(true);setCategoryError('')
    try {const j=await request('/finance/categories','POST',{name:categoryName.trim(),transaction_type:kind});setCategories(c=>[...c,j.data].sort((a,b)=>a.name.localeCompare(b.name,'ru')));setAddingCategory(false);setCategoryName('');setNotice('Категория «'+j.data.name+'» добавлена.')}catch(err){setCategoryError(errorText(err))}finally{setSaving(false)}
  }
  const periodControl=<div className="f-segment" aria-label="Период">{[['month','Месяц'],['3m','3 мес.'],['6m','6 мес.'],['year','Год']].map(([value,label])=><button key={value} aria-pressed={period===value} onClick={()=>{setPeriod(value);setSelected(null)}}>{label}</button>)}</div>
  return <div className="finance-page">
    <div className="section-title"><h2>Финансы</h2><button className="f-icon" aria-label="Обновить финансы" disabled={loading} onClick={()=>void refresh()}>↻</button></div>
    <div className="f-segment" aria-label="Область финансов"><button aria-pressed={scope==='family'} onClick={()=>setScope('family')}>Семейные</button><button aria-pressed={scope==='personal'} onClick={()=>setScope('personal')}>Мои</button></div>
    {scope==='family'&&<div className="f-tabs" role="tablist" aria-label="Разделы финансов">{tabs.map(([key,label])=><button role="tab" id={`finance-tab-${key}`} aria-selected={tab===key} aria-controls={`finance-panel-${key}`} key={key} onClick={()=>{setTab(key);setError('');setNotice('')}}>{label}</button>)}</div>}
    <Message text={error} error/><Message text={notice}/>
    {loading&&<p className="f-loading" role="status">Обновляем данные…</p>}
    {scope==='personal'&&<PersonalFinanceScreen categories={categories} admin={admin} onCategoryCreated={rememberCategory} onChanged={()=>void refresh()}/> }
    {scope==='family'&&<div role="tabpanel" id={`finance-panel-${tab}`} aria-labelledby={`finance-tab-${tab}`} className="f-stack">
    {(tab==='overview'||tab==='budget')&&<section className="card f-current-cash"><h3>Доступно на общие расходы</h3><strong className="f-savings-total">{analytics?.available_cash!=null?money(analytics.available_cash):'—'}</strong><p className="muted">По внесённым операциям за всё время, без денег в копилках. Будущие платежи ещё не вычтены.</p></section>}
    {tab==='overview'&&<>
      {periodControl}
      <div className="f-metrics"><div><small>Доходы</small><strong className="f-positive">{money(income)}</strong></div><div><small>Расходы</small><strong>{money(expense)}</strong></div><div><small>Разница за период</small><strong className={income<expense?'danger':'f-positive'}>{money(income-expense)}</strong></div></div>
      <div className="f-actions"><button className="button primary" onClick={()=>setTx({type:'EXPENSE'})}>＋ Расход</button><button className="button secondary" onClick={()=>setTx({type:'INCOME'})}>＋ Доход</button><Help label="Как добавить расход по чеку" text="Откройте вкладку «Чеки», загрузите фото и подтвердите позиции. Расходы появятся в обзоре автоматически."/></div>
      <section className="card"><Head title="Расходы по категориям"><Help text="Выберите категорию, чтобы посмотреть её операции. Все категории и создание новых — во вкладке «Категории»."/></Head>
        {ranked.length?<><div className="f-expense-total">{money(selected?ranked.find(c=>c.name===selected)?.amount:expense)}</div>{ranked.map(c=><button key={c.id} className="f-category-stat" aria-pressed={selected===c.name} onClick={()=>setSelected(v=>v===c.name?null:c.name)}><span><strong>{c.name}</strong><small>{expense?Math.round(c.amount/expense*100):0}%</small><b>{money(c.amount)}</b></span><span className="f-progress"><i style={{width:`${expense?Math.min(100,c.amount/expense*100):0}%`,background:c.color||'var(--primary)'}}/></span></button>)}</>:<Empty>Расходов за этот период пока нет.</Empty>}
      </section>
      <section className="card"><Head title="Динамика за 6 месяцев"><Help text="Каждая пара столбиков показывает доходы и расходы за месяц. Суммы рассчитываются по сохранённым операциям."/></Head><div className="f-trend">{(analytics?.trend||[]).map((m:any)=>{const max=Math.max(1,...(analytics?.trend||[]).flatMap((x:any)=>[Number(x.income),Number(x.expense)]));return <div key={m.month}><div className="f-trend-bars"><i title={`Доходы: ${money(m.income)}`} style={{height:`${Math.max(0,Number(m.income)/max*100)}%`}}/><i title={`Расходы: ${money(m.expense)}`} style={{height:`${Math.max(0,Number(m.expense)/max*100)}%`}}/></div><small>{m.label}</small><Help label={`Суммы за ${m.label}`} text={`Доходы: ${money(m.income)}. Расходы: ${money(m.expense)}.`}/></div>})}</div><div className="f-legend"><span>● Доходы</span><span>● Расходы</span></div></section>
      <section className="card"><Head title="Операции"><Help text="Показаны последние 20 операций выбранного периода. Добавить доход или расход можно кнопками над обзором."/></Head>{transactions.filter(t=>{
        return inPeriod(t.occurred_on,period)&&(!selected||t.type==='EXPENSE'&&t.category===selected)
      }).slice(0,20).map(t=><div className="f-row" key={t.id}><div className="f-copy"><strong>{t.category}</strong><small>{dateLabel(t.occurred_on)}{t.description?' · '+t.description:''} · Автор: {authorName(t.creator)}</small></div><b className={t.type==='INCOME'?'f-positive':''}>{t.type==='INCOME'?'+':'−'}{money(t.amount)}</b></div>)}{!transactions.length&&<Empty>Операций пока нет.</Empty>}</section>
    </>}
    {tab==='income'&&<section className="card">
      <Head title="История доходов"><button className="button secondary" onClick={()=>setTx({type:'INCOME'})}>＋ Доход</button></Head>
      <Field label="Период доходов"><select value={incomePeriod} onChange={e=>{setIncomePeriod(e.target.value);setIncomeLimit(20)}}>{[['all','За всё время'],['month','Этот месяц'],['3m','Последние 3 месяца'],['6m','Последние 6 месяцев'],['year','Этот год']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
      <div className="f-income-summary"><small>Всего за период · Записей: {incomeRows.length}</small><strong className="f-positive">{money(incomeRows.reduce((sum,t)=>sum+Number(t.amount),0))}</strong></div>
      {incomeRows.slice(0,incomeLimit).map(t=><div className="f-row" key={t.id}><div className="f-copy"><strong>{t.category}</strong><small>{dateLabel(t.occurred_on)} · Автор: {authorName(t.creator)}</small>{t.created_at&&<small>Добавлено: {new Date(t.created_at).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'})}</small>}{t.description&&<small>{t.description}</small>}</div><b className="f-positive">+{money(t.amount)}</b></div>)}
      {!incomeRows.length&&<Empty>Доходов за этот период пока нет.</Empty>}
      {incomeRows.length>incomeLimit&&<button className="button secondary" onClick={()=>setIncomeLimit(n=>n+20)}>Показать ещё</button>}
    </section>}
    {tab==='categories'&&<section className="card"><Head title="Категории"><Help text={admin?'Здесь создаются категории. Операции вносятся во вкладке «Обзор». Доходы и расходы используют отдельные списки.':'Категории создаёт администратор семьи. Операции можно вносить во вкладке «Обзор».'}/></Head>
      <div className="f-segment"><button aria-pressed={kind==='EXPENSE'} onClick={()=>setKind('EXPENSE')}>Расходы</button><button aria-pressed={kind==='INCOME'} onClick={()=>setKind('INCOME')}>Доходы</button></div>
      <div className="f-search"><input aria-label="Поиск категории" placeholder="Поиск категории" value={search} onChange={e=>setSearch(e.target.value)}/>{admin&&<button className="button secondary" onClick={()=>{setCategoryName('');setCategoryError('');setAddingCategory(true)}}>＋ Категория</button>}</div>
      <div className="f-category-list">{rows.map(c=><div className="f-row" key={c.id}><span className="f-category-icon">{c.icon||'•'}</span><strong className="f-copy">{c.name}</strong><small>{kind==='INCOME'?'Доход':'Расход'}</small></div>)}</div>{!rows.length&&<Empty>Категории не найдены.</Empty>}
    </section>}
    {tab==='receipts'&&<Receipts initialFile={initialReceiptFile} onConsumed={onReceiptConsumed} ready={!loading&&!error} categories={categories.filter(c=>c.transaction_type==='EXPENSE')} admin={admin} onCategoryCreated={rememberCategory} onSaved={done}/>}
    {tab==='cashback'&&<CashbackScreen initialFiles={initialCashbackFiles} onConsumed={onCashbackConsumed}/>}
    {tab==='credits'&&<Credits admin={admin}/>}
    {tab==='budget'&&<Budget categories={categories.filter(c=>c.transaction_type==='EXPENSE')} admin={admin} onCategoryCreated={rememberCategory} onSaved={done} periodControl={periodControl} income={income} expense={expense}/>}
    {tab==='overview'&&<SavingsFamilyHistory key={transactions.length+':'+analytics?.available_cash}/>}
    </div>}
    {tx&&<Transaction type={tx.type} categories={categories.filter(c=>c.transaction_type===tx.type)} admin={admin} onCategoryCreated={rememberCategory} onClose={()=>setTx(null)} onSaved={()=>{window.dispatchEvent(new Event('family-first-entry-saved'));setTx(null);done(tx.type==='INCOME'?'Доход сохранён.':'Расход сохранён.')}}/>}
    {addingCategory&&<Modal title={kind==='INCOME'?'Категория дохода':'Категория расхода'} onClose={()=>setAddingCategory(false)} busy={saving}><form className="f-form" onSubmit={createCategory}><div className="f-form-fields"><Field label="Название"><input required maxLength={80} placeholder="Введите название" value={categoryName} onChange={e=>setCategoryName(e.target.value)} autoFocus/></Field></div><Message text={categoryError} error/><button className="button primary" disabled={saving||!categoryName.trim()}>{saving?'Сохраняем…':'Создать категорию'}</button></form></Modal>}
  </div>
}
export function Transaction({type,categories,admin,onCategoryCreated,onClose,onSaved,existing}:{type:Kind;categories:Category[];admin:boolean;onCategoryCreated:(c:Category)=>void;onClose:()=>void;onSaved:()=>void;existing?:any}) {
  const [amount,setAmount]=useState(existing?String(existing.amount):''),[category,setCategory]=useState(existing?.category_id||categories.find(c=>c.name===existing?.category)?.id||''),[date,setDate]=useState(existing?.occurred_on?.slice(0,10)||today()),[description,setDescription]=useState(existing?.description||''),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  const [pots,setPots]=useState<any[]>([]),[pot,setPot]=useState(''),[reserve,setReserve]=useState(''),[potError,setPotError]=useState('')
  const requestKey=useRef(crypto.randomUUID()),lastBody=useRef('')
  useEffect(()=>{if(type==='INCOME'&&!existing){let active=true;request('/finance/personal').then(j=>{if(active)setPots((j.data?.pots||[]).filter((p:any)=>!p.archived_at))}).catch(()=>{if(active)setPotError('Не удалось загрузить копилки. Можно сохранить доход и отложить деньги позже.')});return()=>{active=false}}},[type])
  const submit=async(e:FormEvent)=>{e.preventDefault();if(saving)return;setSaving(true);setError('');try{
    const c=categories.find(c=>c.id===category);if(!c)throw new Error('Выберите категорию.')
    const body={type,amount:Number(amount),category:c.name,category_id:c.id,occurred_on:date,description,...(pot?{savings_pot_id:pot,savings_amount:Number(reserve)}:{})}
    const text=JSON.stringify(body);if(lastBody.current&&lastBody.current!==text)requestKey.current=crypto.randomUUID();lastBody.current=text
    await request(existing?`/finances/${existing.id}`:'/finances',existing?'PATCH':'POST',{...body,...(!existing?{request_key:requestKey.current}:{})});onSaved()
  }catch(e){setError(errorText(e))}finally{setSaving(false)}}
  return <Modal title={existing?'Редактировать доход':type==='INCOME'?'Новый доход':'Новый расход'} onClose={onClose} busy={saving}><form className="f-form" onSubmit={submit}><div className="f-form-fields"><Field label="Сумма, ₽"><input type="number" inputMode="decimal" required min="0.01" max="9999999999.99" step="0.01" placeholder="0" value={amount} onChange={e=>setAmount(e.target.value)} autoFocus/></Field><Field label="Категория"><CategorySelect categories={categories} type={type} admin={admin} value={category} onSelect={c=>setCategory(c.id)} onCreated={onCategoryCreated} required disabled={saving}/></Field><div className="f-form-pair"><Field label={type==='INCOME'?'Дата дохода':'Дата расхода'}><input type="date" required value={date} onChange={e=>setDate(e.target.value)}/>{type==='INCOME'&&<small className="muted">Можно указать прошедшую дату. Дата внесения сохранится отдельно.</small>}</Field><Field label="Заметка"><input maxLength={255} placeholder="Необязательно" value={description} onChange={e=>setDescription(e.target.value)}/></Field></div>
    {type==='INCOME'&&!existing&&pots.length>0&&<><Field label="Отложить в копилку"><select value={pot} onChange={e=>setPot(e.target.value)}><option value="">Весь доход — в бюджет</option>{pots.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>{pot&&<Field label="Отложить, ₽"><input type="number" inputMode="decimal" min="0.01" max={Number(amount)||0} step="0.01" required value={reserve} onChange={e=>setReserve(e.target.value)}/></Field>}</>}
    </div>{pot&&<p className="muted">Из этого дохода семье останется {money(Math.max(0,Number(amount)-Number(reserve)))}.</p>}{existing&&<p className="muted">Изменение дохода пересчитает доступную семье сумму. Ранее сделанные переводы в копилки сохранятся — их можно вернуть отдельно.</p>}{potError&&<p role="status">{potError}</p>}<Message text={error} error/><button className="button primary" disabled={saving}>{saving?'Сохраняем…':type==='INCOME'?'Сохранить доход':'Сохранить расход'}</button></form></Modal>
}

async function preparePhoto(file:File):Promise<string> {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Выберите фото в формате JPEG, PNG или WebP.')
  if(file.size>20*1024*1024)throw new Error('Фото слишком большое. Выберите изображение размером до 20 МБ.')
  const original=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Не удалось прочитать фото. Выберите другое изображение.'));reader.readAsDataURL(file)})
  const image=await createImageBitmap(file)
  try {if(file.size<=8*1024*1024&&Math.max(image.width,image.height)<=3200)return original;const ratio=Math.min(1,3200/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*ratio);canvas.height=Math.round(image.height*ratio);canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.9)}finally{image.close()}
}
function Receipts({categories,admin,onCategoryCreated,onSaved,initialFile,onConsumed,ready}:{categories:Category[];admin:boolean;onCategoryCreated:(c:Category)=>void;onSaved:(text:string)=>void;initialFile?:File|null;onConsumed?:()=>void;ready:boolean}) {
  const consumedFile=useRef<File|null>(null)
  const [dirty,setDirty]=useState(false)
  const [metadataReviewed,setMetadataReviewed]=useState(false)
  const reviewStatusId=useId()
  const [list,setList]=useState<any[]>([]),[receipt,setReceipt]=useState<any>(null),[items,setItems]=useState<Item[]>([])
  const [receiptTotal,setReceiptTotal]=useState(''),[editIndex,setEditIndex]=useState<number|null>(null),[editMeta,setEditMeta]=useState(false),[deleting,setDeleting]=useState<any>(null)
  const [merchant,setMerchant]=useState(''),[date,setDate]=useState(today()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const refresh=async()=>{try{const j=await request('/finance/receipts');setList(j.data||[])}catch(e){setError(errorText(e))}}
  useEffect(()=>{void refresh()},[])
  const select=(r:any)=>{
    setDirty(false)
    setMetadataReviewed(false)
    const p=r.review_payload||r.ai_result?.parsed||r.ai_result?.review_payload||{}
    setReceipt(r);setEditIndex(null);setEditMeta(false);setReceiptTotal(p.receipt_total!=null?String(p.receipt_total):p.total!=null?String(p.total):'');setMerchant(p.merchant||'');setDate(p.date||today());setItems((p.items||[]).map((it:any)=>{const c=categories.find(c=>c.id===it.category_id||c.name===it.category)||(!it.category_needs_review?(categories.find(c=>c.name==='Покупки')||categories[0]):undefined);return {name:it.name||'',qty:Number(it.qty)||0,price:Number(it.price)||0,needs_review:!!it.needs_review,category_needs_review:!!it.category_needs_review,category:c?.name||(it.category_needs_review?'':'Покупки'),category_id:c?.id}}));setError('');setNotice('')
  }
  const upload=async(file:File)=>{if(busy)return;setBusy(true);setError('');try{const image=await preparePhoto(file);const j=await request('/finance/receipts','POST',{file_name:file.name,mime_type:image.slice(5,image.indexOf(';')),image_data:image});select(j.data);if(j.data.duplicate)setNotice('Этот чек уже загружен в семье. Открыли сохранённый чек — повторные расходы не созданы.');await refresh()}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  useEffect(()=>{if(initialFile&&ready&&consumedFile.current!==initialFile){consumedFile.current=initialFile;void upload(initialFile);onConsumed?.()}},[initialFile,ready])
  const open=async(id:string)=>{if(busy)return;setBusy(true);setError('');try{select((await request(`/finance/receipts/${id}`)).data)}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  useEffect(()=>{
    if(!receipt||receipt.ocr_status!=='AWAITING_DATA'||dirty||busy||items.length)return
    let active=true
    const timer=window.setInterval(()=>{void request(`/finance/receipts/${receipt.id}`).then(j=>{if(active&&j.data.ocr_status!=='AWAITING_DATA'){select(j.data);void refresh()}}).catch(()=>{})},15000)
    return()=>{active=false;window.clearInterval(timer)}
  },[receipt?.id,receipt?.ocr_status,dirty,busy,items.length])
  const update=(index:number,patch:Partial<Item>)=>{setDirty(true);setItems(rows=>rows.map((r,i)=>i===index?{...r,...patch,...(patch.category_id?{category_needs_review:false}:{})}:r))}
  const total=items.reduce((s,i)=>s+Math.round(i.qty*i.price*100)/100,0),finalized=receipt?.ocr_status==='CONFIRMED',confirmed=finalized||receipt?.can_edit===false
  const metadataReason=receipt?.review_payload?.review_reason,metadataNeedsReview=!metadataReviewed&&['TOTAL_UNCERTAIN','DATE_UNCERTAIN'].includes(metadataReason)
  const ocrFailureMessage=metadataReason==='OCR_TIMEOUT'?'Сервер не успел обработать чек. Фото сохранено — нажмите «Распознать ещё раз».':metadataReason==='OCR_UNAVAILABLE'?'Распознавание на сервере сейчас недоступно. Фото сохранено — сообщите администратору.':''
  const expected=receiptTotal.trim()===''?null:Number(receiptTotal),balanced=expected!==null&&expected>0&&Math.abs(total-expected)<=0.02,validItems=!metadataNeedsReview&&receipt?.qr_state!=='UNSUPPORTED'&&items.length>0&&items.every(i=>i.name.trim()&&i.qty>0&&i.price>0&&!i.needs_review&&(!i.category_needs_review||!!i.category_id))
  const problemIndex=items.findIndex(i=>!i.name.trim()||i.qty<=0||i.price<=0||i.needs_review||i.category_needs_review&&!i.category_id)
  const multipleReceipts=receipt?.review_payload?.review_reason==='MULTIPLE_RECEIPTS'
  const reviewMessage=ocrFailureMessage&&!items.length?'Можно повторить обработку сохранённого фото или заполнить чек вручную.':metadataNeedsReview?(metadataReason==='TOTAL_UNCERTAIN'?'Итог прочитан по-разному. Сверьте сумму с фото и введите её в поле «Итог на чеке».':'Дата прочитана по-разному. Сверьте её с фото и сохраните через карандаш у названия чека.'):multipleReceipts&&!items.length?'Нужно фото одного чека целиком.':receipt?.qr_state==='WAITING'&&!items.length?'Позиции появятся после получения электронного чека.':expected===null||!Number.isFinite(expected)||expected<=0?'Итог не распознан. Введите сумму с чека в поле выше.':!items.length?'Добавьте хотя бы одну позицию чека.':problemIndex>=0?(items[problemIndex].category_needs_review&&!items[problemIndex].category_id?`Выберите категорию позиции ${problemIndex+1}.`:`Проверьте название, количество и цену позиции ${problemIndex+1}.`):!balanced?`На чеке ${money(expected)} — проверьте позиции. Добавьте пропущенные товары или исправьте цифры.`: 'Всё готово. Нажмите «Подтвердить расходы».'
  const save=async(confirm:boolean)=>{
    if(busy||!receipt)return;setBusy(true);setError('');setNotice('')
    try{
      if(confirm&&metadataNeedsReview)throw new Error('Проверьте и сохраните сумму и дату чека.')
      if(confirm&&(!items.length||items.some(i=>!i.name.trim()||i.qty<=0||i.price<=0||i.needs_review)))throw new Error('Укажите название, количество и цену для каждой позиции.')
      if(confirm&&items.some(i=>i.category_needs_review&&!i.category_id))throw new Error('Выберите категорию для каждой позиции чека.')
      if(confirm&&!balanced)throw new Error('Сумма позиций не совпадает с итогом чека. Проверьте количество, цены и итог.');
      const payload={merchant,date,total,receipt_total:expected,items}
      const j=await request(`/finance/receipts/${receipt.id}${confirm?'/confirm':''}`,confirm?'POST':'PATCH',payload)
      if(confirm){setReceipt(null);setItems([]);onSaved(`Чек подтверждён. Добавлены расходы на ${money(j.data.total_amount)}.`)}else {setReceipt(j.data);setNotice('Черновик чека сохранён.')}
      await refresh()
    }catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  const retry=async()=>{if(busy)return;setBusy(true);setError('');try{select((await request(`/finance/receipts/${receipt.id}/retry`,'POST',{})).data);await refresh()}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  const remove=async()=>{if(busy||!deleting)return;setBusy(true);setError('');try{await request(`/finance/receipts/${deleting.id}`,'DELETE');if(receipt?.id===deleting.id){setReceipt(null);setItems([])}setDeleting(null);await refresh();setNotice('Черновик чека удалён.')}catch(e){setError(errorText(e));setDeleting(null)}finally{setBusy(false)}}
  const canDelete=(r:any)=>r.can_edit!==false&&r.ocr_status!=='CONFIRMED'
  const status=(r:any)=>r.ocr_status==='CONFIRMED'?'Расходы сохранены':r.ocr_status==='AWAITING_DATA'?'Ожидаем данные чека':r.ocr_status==='COMPLETED'?'Проверьте позиции':'Нужна проверка'
  const qrMessage=receipt?.qr_state==='WAITING'?'QR-код прочитан. Ожидаем электронный чек с позициями. Запрос повторится автоматически.':receipt?.qr_state==='READY'?'Получены позиции электронного чека. Проверьте категории и подтвердите расходы.':receipt?.qr_state==='NOT_CONFIGURED'?'QR-код прочитан: сумма и дата взяты из него. Позиции распознаны по фото — проверьте их.':receipt?.qr_state==='UNSUPPORTED'?'Это чек возврата или другой операции. Его нельзя сохранить как расход по покупке.':receipt?.qr_state==='ACCESS_ERROR'?'Сервис не принял ключ доступа. Попросите администратора проверить настройку распознавания чеков.':receipt?.qr_state==='LIMIT_EXCEEDED'?'Достигнут лимит запросов сервиса чеков. Сумма и дата сохранены из QR-кода. Можно заполнить позиции вручную или повторить запрос после восстановления лимита.':receipt?.qr_state==='INVALID_QR'?'Сервис не подтвердил реквизиты чека. Попробуйте другое фото или заполните позиции вручную.':['INVALID_DATA','UNAVAILABLE'].includes(receipt?.qr_state)?'Не удалось получить полный электронный чек. Повторите запрос позже или заполните позиции вручную.':''
  const editItem=editIndex===null?null:items[editIndex]
  return <div className="f-stack f-receipts"><section className="card"><Head title={receipt?'Проверка чека':'Чеки'}><div className="f-actions"><Help text="По фискальному QR получаем электронный чек. Линейный штрихкод магазина его не заменяет: такой чек читается по тексту на фото. Снимайте один чек целиком, сверху, не закрывая товары и итог. Расходы создаются после проверки позиций. Для исправления нажмите на карандаш у товара; сумма позиций должна совпасть с итогом чека."/>{receipt&&<button className="f-icon" disabled={busy} aria-label="Закрыть чек" onClick={()=>setReceipt(null)}>×</button>}</div></Head>
    {!receipt&&<div className="f-receipt-upload">{[{label:'Сфотографировать чек',camera:true},{label:'Выбрать из галереи',camera:false}].map(({label,camera})=><label key={label} className={`button ${camera?'primary':'secondary'} f-upload ${busy?'f-disabled':''}`}>{busy?'Обрабатываем…':label}<input aria-label={camera?'Сфотографировать чек':'Фото чека'} type="file" accept="image/jpeg,image/png,image/webp" capture={camera?'environment':undefined} disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void upload(f)}}/></label>)}</div>}
    <Message text={error} error/><Message text={notice}/>
    {receipt&&<div className="f-receipt-review">
      <Message text={qrMessage}/>
      {!items.length&&<Message text={ocrFailureMessage} error/>}
      {multipleReceipts&&<Message text="На фото несколько чеков. Загрузите отдельное фото нужного чека целиком, чтобы не смешать покупки." error/>}
      <div className="f-receipt-meta"><div className="f-copy"><strong>{merchant||'Чек'} · {dateLabel(date)}</strong></div>{!confirmed&&<button className="f-icon" disabled={busy} aria-label="Изменить данные чека" onClick={()=>{setDirty(true);setEditMeta(true)}}>✎</button>}</div>
      {!items.length&&!multipleReceipts&&!ocrFailureMessage&&receipt.qr_state!=='WAITING'&&receipt.qr_state!=='UNSUPPORTED'&&<Message text="Фото сохранено, но позиции не удалось прочитать. Загрузите чёткое фото одного чека целиком или добавьте товары вручную."/>}
      <div className="f-receipt-lines">{items.map((it,index)=><div className="f-receipt-line" key={index}>
        <span className="f-line-index">{index+1}</span><div className="f-copy"><strong title={it.name}>{it.name||'Без названия'}</strong><small>{it.qty>0?it.qty:'?'} × {money(it.price)}{it.needs_review&&<span className="danger"> · Проверьте цифры</span>}</small>{confirmed?<small>Категория: {it.category}</small>:<label className="f-line-category"><span>Категория</span><CategorySelect categories={categories} admin={admin} label={`Категория позиции ${index+1}`} value={it.category_id||''} disabled={busy} onSelect={c=>update(index,{category:c.name,category_id:c.id})} onCreated={onCategoryCreated}/></label>}</div><div className="f-line-end"><b>{money(Math.round(it.qty*it.price*100)/100)}</b>{!confirmed&&<button className="f-icon" aria-label={`Изменить позицию ${index+1}`} disabled={busy} onClick={()=>setEditIndex(index)}>✎</button>}</div>
      </div>)}</div>
      {!confirmed&&items.some(i=>i.category_needs_review)&&<div className="f-row"><small>Есть позиции без точного подбора категории.</small><Help label="Как проверить категории чека" text="Проверьте категории товаров: при неоднозначном названии оставлена общая категория или пустое поле. Выберите подходящую из списка. Подтверждённый выбор будет учтён для такого же товара в следующих чеках семьи."/></div>}
      {!confirmed&&<div className="f-receipt-tools"><button className="button ghost" disabled={busy} onClick={()=>{setItems(rows=>[...rows,{name:'',qty:1,price:0,category:categories.find(c=>c.name==='Покупки')?.name||categories[0]?.name||'Покупки',category_id:categories.find(c=>c.name==='Покупки')?.id||categories[0]?.id}]);setEditIndex(items.length)}}>＋ Позиция</button><button className="button ghost" disabled={busy} onClick={()=>void retry()}>{busy?'Распознаём…':'Распознать ещё раз'}</button></div>}
      <div className="f-receipt-total"><div><span>Итого по позициям</span><b>{receipt.qr_state==='WAITING'&&!items.length?'—':money(total)}</b></div>{!confirmed&&<Field label="Итог на чеке, ₽"><input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="Введите сумму с чека" value={receiptTotal} disabled={busy} aria-invalid={expected===null||expected<=0} aria-describedby={reviewStatusId} onChange={e=>{setDirty(true);setReceiptTotal(e.target.value);if(metadataReason==='TOTAL_UNCERTAIN')setMetadataReviewed(true)}}/></Field>}<small id={reviewStatusId} aria-live="polite" className={receipt.qr_state==='WAITING'&&!items.length||balanced&&validItems?'f-positive':'danger'}>{finalized?'Расходы по чеку сохранены.':confirmed?'Изменить и подтвердить этот чек может его автор или администратор семьи.':reviewMessage}</small>{!confirmed&&problemIndex>=0&&<button className="f-review-fix" disabled={busy} onClick={()=>setEditIndex(problemIndex)}>Проверить позицию {problemIndex+1} →</button>}</div>
      {!confirmed&&<div className="f-receipt-submit"><button className="button primary" disabled={busy||!validItems||!balanced} aria-describedby={reviewStatusId} onClick={()=>void save(true)}>{busy?'Сохраняем…':'Подтвердить расходы'}</button><button className="button ghost" disabled={busy} onClick={()=>void save(false)}>Черновик</button></div>}
    </div>}
  </section>
  <section className="card"><Head title="История чеков"/>{list.length?list.map(r=><div key={r.id} className="f-row f-receipt-history"><button className="f-history f-history-open" disabled={busy} onClick={()=>void open(r.id)}><div className="f-copy"><strong>{r.review_payload?.merchant||r.file_name||'Чек'}</strong><small>{dateLabel(r.created_at)} · {status(r)}</small></div><span>›</span></button>{canDelete(r)&&<button className="f-icon danger" aria-label={`Удалить черновик ${r.review_payload?.merchant||r.file_name||'чека'}`} disabled={busy} onClick={()=>setDeleting(r)}>⌫</button>}</div>):<Empty>Загруженных чеков пока нет.</Empty>}</section>
  {deleting&&<Modal title="Удалить черновик?" onClose={()=>setDeleting(null)} busy={busy}><div className="f-form"><p>Фото и распознанные позиции этого черновика будут удалены.</p><div className="f-actions"><button className="button secondary" disabled={busy} onClick={()=>setDeleting(null)}>Отмена</button><button className="button primary f-danger-button" disabled={busy} onClick={()=>void remove()}>{busy?'Удаляем…':'Удалить черновик'}</button></div></div></Modal>}
  {editItem&&editIndex!==null&&<Modal title={`Позиция ${editIndex+1}`} onClose={()=>setEditIndex(null)}><div className="f-form"><div className="f-form-fields"><Field label={`Товар ${editIndex+1}`}><textarea rows={3} maxLength={255} value={editItem.name} onChange={e=>update(editIndex,{name:e.target.value})}/></Field><div className="f-receipt-quantity-price"><Field label="Количество"><input type="number" inputMode="decimal" min="0.001" step="0.001" value={editItem.qty} onChange={e=>update(editIndex,{qty:Number(e.target.value)})}/></Field><Field label="Цена, ₽"><input type="number" inputMode="decimal" min="0.01" step="0.01" value={editItem.price} onChange={e=>update(editIndex,{price:Number(e.target.value)})}/></Field></div><Field label="Категория"><CategorySelect categories={categories} admin={admin} value={editItem.category_id||''} onSelect={c=>update(editIndex,{category:c.name,category_id:c.id})} onCreated={onCategoryCreated}/></Field></div><div className="f-actions"><button className="button primary" onClick={()=>{update(editIndex,{needs_review:false});setEditIndex(null)}}>Готово</button><button className="button ghost danger" onClick={()=>{setItems(rows=>rows.filter((_,i)=>i!==editIndex));setEditIndex(null)}}>Удалить позицию</button></div></div></Modal>}
  {editMeta&&<Modal title="Данные чека" onClose={()=>setEditMeta(false)}><div className="f-form"><div className="f-form-fields"><Field label="Магазин"><input maxLength={255} value={merchant} onChange={e=>setMerchant(e.target.value)}/></Field><Field label="Дата покупки"><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field></div><button className="button primary" onClick={()=>{if(metadataReason==='DATE_UNCERTAIN')setMetadataReviewed(true);setEditMeta(false)}}>Готово</button></div></Modal>}
  </div>
}
function Credits({admin}:{admin:boolean}) {
  const [credits,setCredits]=useState<any[]>([]),[selected,setSelected]=useState(''),[adding,setAdding]=useState(false),[editCredit,setEditCredit]=useState(false)
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const refresh=async()=>{setLoading(true);try{const j=await request('/credits');setCredits(j.data||[])}catch(e){setError(errorText(e))}finally{setLoading(false)}}
  useEffect(()=>{void refresh()},[])
  const credit=credits.find(c=>c.id===selected)||credits[0]
  return <div className="f-stack credits-screen"><Message text={error} error/><Message text={notice}/><section className="card"><Head title="Кредиты">{admin?<><button className="button secondary" onClick={()=>setAdding(true)}>＋ Добавить</button>{credit&&<button className="credit-icon-button" aria-label="Изменить условия кредита" onClick={()=>setEditCredit(true)}><CreditActionIcon kind="edit"/></button>}</>:<Help text="Кредиты и досрочные платежи добавляет администратор семьи."/>}</Head>
    {loading&&!credits.length?<Empty>Загружаем кредиты…</Empty>:credits.length?<div className="f-credit-list">{credits.map(c=><button key={c.id} className="f-credit" aria-pressed={credit?.id===c.id} onClick={()=>{setSelected(c.id);setError('');setNotice('')}}><span className="credit-identity"><strong>{c.name||'Кредит'}</strong><small>{c.type==='INSTALLMENT'?'Рассрочка':'Кредит'}{Number(c.annual_rate)>0?' · '+Number(c.annual_rate)+'%':''} · {c.term_months} мес.</small></span></button>)}</div>:<Empty>Кредиты и рассрочки пока не добавлены.</Empty>}

  </section>

  {credit&&<CreditTools key={credit.id} credit={credit} admin={admin} onSaved={refresh}/>}
  {adding&&<AddCredit onClose={()=>setAdding(false)} onSaved={id=>{setAdding(false);setSelected(id);setNotice('Кредит сохранён.');void refresh()}}/>}
  {editCredit&&credit&&<AddCredit existing={credit} onClose={()=>setEditCredit(false)} onSaved={()=>{setEditCredit(false);setNotice('Условия кредита сохранены.');void refresh()}}/>}
  </div>
}
function AddCredit({onClose,onSaved,existing}:{onClose:()=>void;onSaved:(id:string)=>void;existing?:any}) {
  const [form,setForm]=useState({type:String(existing?.type||'CREDIT'),name:String(existing?.name||''),principal:String(existing?.principal||''),annual_rate:String(existing?.annual_rate||''),standard_payment:String(existing?.standard_payment||''),term_months:String(existing?.term_months||''),start_date:existing?.start_date?.slice(0,10)||today(),first_payment_date:existing?.first_payment_date?.slice(0,10)||today(),recalculation_mode:String(existing?.recalculation_mode||'TERM')})
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const field=(key:keyof typeof form,value:string)=>setForm(f=>({...f,[key]:value}))
  const submit=async(e:FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const j=await request(existing?`/credits/${existing.id}`:'/credits',existing?'PATCH':'POST',{...form,principal:Number(form.principal),annual_rate:form.type==='INSTALLMENT'?0:Number(form.annual_rate),standard_payment:Number(form.standard_payment),term_months:Number(form.term_months)});onSaved(j.data.id)}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  return <Modal title={existing?"Условия кредита":"Новый кредит или рассрочка"} onClose={onClose} busy={busy}><form className="f-form" onSubmit={submit}><div className="f-form-fields"><Field label="Тип"><select disabled={!!existing} value={form.type} onChange={e=>field('type',e.target.value)}><option value="CREDIT">Кредит</option><option value="INSTALLMENT">Рассрочка</option></select></Field><Field label="Название"><input autoFocus required maxLength={120} placeholder="Введите название" value={form.name} onChange={e=>field('name',e.target.value)}/></Field><div className="f-form-pair"><Field label="Сумма, ₽"><input type="number" required min="0.01" step="0.01" placeholder="0" value={form.principal} onChange={e=>field('principal',e.target.value)}/></Field><Field label="Срок, месяцев"><input type="number" required min="1" max="600" step="1" placeholder="0" value={form.term_months} onChange={e=>field('term_months',e.target.value)}/></Field></div><div className="f-form-pair">{form.type==='CREDIT'&&<Field label="Ставка, % годовых"><input type="number" required min="0" max="100" step="0.0001" placeholder="0" value={form.annual_rate} onChange={e=>field('annual_rate',e.target.value)}/></Field>}<Field label="Платёж в месяц, ₽"><input type="number" required min="0.01" step="0.01" placeholder="0" value={form.standard_payment} onChange={e=>field('standard_payment',e.target.value)}/></Field></div><div className="f-form-pair"><Field label="Дата договора"><input type="date" required value={form.start_date} onChange={e=>field('start_date',e.target.value)}/></Field><Field label="Первый платёж"><input type="date" required min={form.start_date} value={form.first_payment_date} onChange={e=>field('first_payment_date',e.target.value)}/></Field></div><Field label="При досрочном погашении"><select value={form.recalculation_mode} onChange={e=>field('recalculation_mode',e.target.value)}><option value="TERM">Уменьшать срок</option><option value="PAYMENT">Уменьшать платёж</option></select></Field></div><Message text={error} error/><button className="button primary" disabled={busy}>{busy?'Сохраняем…':'Сохранить кредит'}</button></form></Modal>
}
function Budget({categories,admin,onCategoryCreated,onSaved,income,expense}:{categories:Category[];admin:boolean;onCategoryCreated:(c:Category)=>void;onSaved:(s:string)=>void;periodControl:ReactNode;income:number;expense:number}) {
  const [month,setMonth]=useState(today().slice(0,7)),[budget,setBudget]=useState<any>(null),[limit,setLimit]=useState(''),[limits,setLimits]=useState<Record<string,string>>({})
  const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false)
  const load=async()=>{setLoaded(false);setError('');try{const [year,m]=month.split('-');const j=await request(`/finance/budgets/${year}/${Number(m)}`),b=j.data?.budget;setBudget(b);setLimit(b?.total_limit!=null?String(b.total_limit):'');setLimits(Object.fromEntries((b?.categories||[]).map((c:any)=>[c.category_id,String(c.limit_amount)])))}catch(e){setError(errorText(e))}finally{setLoaded(true)}}
  useEffect(()=>{void load()},[month])
  const save=async(e:FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await request('/finance/budgets/save','POST',{year:Number(month.slice(0,4)),month:Number(month.slice(5,7)),total_limit:Number(limit),categories:Object.entries(limits).filter(([,value])=>value!=='').map(([category_id,value])=>({category_id,limit_amount:Number(value)}))});setEditing(false);await load();onSaved('Лимиты бюджета сохранены.')}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  const hasLimit=!!budget?.id||Number(budget?.total_limit)>0
  const selectedCategories=categories.filter(c=>Object.hasOwn(limits,c.id))
  const availableCategories=categories.filter(c=>!Object.hasOwn(limits,c.id))
  const closeEditor=()=>{setEditing(false);void load()}
  return <div className="f-stack f-budget"><section className="card"><Head title="Бюджет на месяц"><Help text="Лимиты задаются здесь. Доходы, расходы и чеки вносятся в соответствующих вкладках. Общий лимит и лимиты категорий настраивает администратор."/></Head><div className="f-budget-month"><Field label="Месяц"><input type="month" required value={month} onChange={e=>{if(e.target.value){setMonth(e.target.value);setEditing(false)}}}/></Field></div><Message text={editing?'':error} error/>{!loaded?<Empty>Загружаем бюджет…</Empty>:<><div className="f-metrics f-budget-summary"><div><small>Общий лимит</small><strong>{hasLimit?money(budget.total_limit):'Не задан'}</strong></div><div><small>Потрачено</small><strong>{money(budget?.spent_amount)}</strong></div><div><small>Осталось</small><strong className={hasLimit?(budget.available_amount<0?'danger':'f-positive'):''}>{hasLimit?money(budget.available_amount):'—'}</strong></div></div>{admin&&<button className="button secondary" onClick={()=>{setError('');setEditing(true)}}>Настроить лимиты</button>}
    {(budget?.categories||[]).map((c:any)=><div className="f-row" key={c.category_id}><strong className="f-copy">{c.name}</strong><div className="f-number"><b>{money(c.spent_amount)}</b><small>из {money(c.limit_amount)}</small></div></div>)}</>}
  </section><section className="card"><Head title="Выбранный период обзора"><Help text="Эти суммы соответствуют периоду, выбранному во вкладке «Обзор». Лимиты выше всегда относятся к выбранному месяцу бюджета."/></Head><div className="f-row"><span>Доходы</span><b>{money(income)}</b></div><div className="f-row"><span>Расходы</span><b>{money(expense)}</b></div><div className="f-row"><span>Разница за период</span><b>{money(income-expense)}</b></div></section>
  {editing&&<Modal title="Лимиты бюджета" onClose={closeEditor} busy={busy}><form className="f-form f-budget-editor" onSubmit={save}><div className="f-form-fields"><Field label="Общий лимит, ₽"><input type="number" min="0" step="0.01" inputMode="decimal" required placeholder="0" value={limit} onChange={e=>setLimit(e.target.value)}/></Field><div className="f-budget-limits-head"><strong>По категориям</strong><Help text="Добавляйте только категории, для которых нужен отдельный лимит. Суммы указываются в рублях. Удаление строки убирает лимит категории после сохранения. Общий лимит действует независимо от лимитов категорий."/></div>
    <div className="f-budget-limits">{selectedCategories.map(c=><div className="f-budget-limit" key={c.id}><Field label={c.name}><input aria-label={`Лимит: ${c.name}`} type="number" inputMode="decimal" min="0" step="0.01" required placeholder="0" value={limits[c.id]} onChange={e=>setLimits(values=>({...values,[c.id]:e.target.value}))}/></Field><button type="button" className="f-icon danger" aria-label={`Убрать лимит: ${c.name}`} disabled={busy} onClick={()=>setLimits(values=>{const next={...values};delete next[c.id];return next})}>×</button></div>)}</div>
    <Field label="Добавить лимит"><CategorySelect categories={availableCategories} admin={admin} value="" disabled={busy} label="Добавить лимит категории" onSelect={c=>setLimits(values=>({...values,[c.id]:''}))} onCreated={onCategoryCreated}/></Field>
    </div><Message text={error} error/><div className="f-actions"><button className="button primary" disabled={busy}>{busy?'Сохраняем…':'Сохранить лимиты'}</button><button type="button" className="button ghost" disabled={busy} onClick={closeEditor}>Отмена</button></div></form></Modal>}
  </div>
}
