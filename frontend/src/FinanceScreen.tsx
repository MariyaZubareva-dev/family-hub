import { useEffect, useId, useRef, useState, type ReactNode, type FormEvent } from 'react'
import './finance.css'

type Kind = 'EXPENSE' | 'INCOME'
type Tab = 'overview' | 'categories' | 'receipts' | 'stocks' | 'credits' | 'budget'
type Category = { id:string; name:string; transaction_type:Kind; icon?:string; color?:string }
type Item = { name:string; qty:number; price:number; category:string; category_id?:string }
const money = (value:unknown) => `${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits:2 })} ₽`
const today = () => new Date().toLocaleDateString('sv-SE')
const dateLabel = (value:string) => value ? new Date(value.slice(0,10)+'T12:00:00').toLocaleDateString('ru-RU') : '—'
const tabs: [Tab,string][] = [['overview','Обзор'],['categories','Категории'],['receipts','Чеки'],['stocks','Запасы'],['credits','Кредиты'],['budget','Бюджет']]
const errorText = (error:unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.'
async function request(path:string, method='GET', body?:unknown) {
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
    if (response.status>=500) throw new Error('Сервер временно недоступен. Попробуйте ещё раз позже.')
    const message = Object.values(json?.errors || {}).flat()[0] || json?.message
    if (typeof message==='string' && /[а-яё]/i.test(message) && !/SQLSTATE|Exception|<|>/.test(message)) throw new Error(message)
    if (response.status===422) throw new Error('Проверьте обязательные поля, суммы и даты. Данные пока не сохранены.')
    if (response.status===409) throw new Error('Эта запись уже сохранена. Обновите список.')
    throw new Error('Не удалось выполнить действие. Попробуйте ещё раз.')
  }
  return json || { data:null }
}
function Help({text,label='Подсказка'}:{text:string;label?:string}) {
  const [open,setOpen]=useState(false)
  const id=useId()
  const ref=useRef<HTMLSpanElement>(null)
  useEffect(()=>{
    if(!open)return
    const outside=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false)}
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)}
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[open])
  return <span className="f-help" ref={ref}><button type="button" className="f-help-button" aria-label={label} aria-expanded={open} aria-describedby={open?id:undefined} onClick={()=>setOpen(v=>!v)}>?</button>{open&&<span id={id} role="tooltip" className="f-tooltip">{text}</span>}</span>
}
function Modal({title,onClose,busy,children}:{title:string;onClose:()=>void;busy?:boolean;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null), id=useId()
  useEffect(()=>{const d=ref.current!;d.showModal();return()=>d.close()},[])
  return <dialog className="finance-dialog" ref={ref} aria-label={title} onCancel={e=>{e.preventDefault();if(!busy)onClose()}} onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}><section><div className="f-head"><h2 id={id}>{title}</h2><button type="button" className="f-icon" onClick={onClose} disabled={busy} aria-label="Закрыть">×</button></div>{children}</section></dialog>
}
function Message({text,error=false}:{text:string;error?:boolean}) { return text?<div className={error?'f-message f-error':'f-message'} role={error?'alert':'status'}>{text}</div>:null }
function Empty({children}:{children:ReactNode}) { return <p className="f-empty">{children}</p> }
function Head({title,children}:{title:string;children?:ReactNode}) {return <div className="f-head"><h3>{title}</h3>{children}</div>}
function Field({label,children}:{label:string;children:ReactNode}) {return <label className="f-field"><span>{label}</span>{children}</label>}

export default function FinanceScreen() {
  const [tab,setTab]=useState<Tab>('overview'), [kind,setKind]=useState<Kind>('EXPENSE')
  const [period,setPeriod]=useState('month'), [categories,setCategories]=useState<Category[]>([])
  const [analytics,setAnalytics]=useState<any>(null), [transactions,setTransactions]=useState<any[]>([])
  const [admin,setAdmin]=useState(false), [shopping,setShopping]=useState(false)
  const [error,setError]=useState(''), [notice,setNotice]=useState(''), [loading,setLoading]=useState(true)
  const [tx,setTx]=useState<null|{type:Kind;category?:string}>(null), [addingCategory,setAddingCategory]=useState(false)
  const [categoryName,setCategoryName]=useState(''), [categoryError,setCategoryError]=useState(''), [saving,setSaving]=useState(false)
  const [search,setSearch]=useState(''), [selected,setSelected]=useState<string|null>(null)
  const refresh=async()=>{
    setLoading(true);setError('')
    const now=new Date()
    try {
      const [c,a,t,m]=await Promise.all([request('/finance/categories'),request(`/finance/analytics?period=${period}&year=${now.getFullYear()}&month=${now.getMonth()+1}`),request('/finances'),request('/me')])
      setCategories(c.data||[]);setAnalytics(a.data);setTransactions(t.data||[]);setAdmin(m.data?.family?.role==='ADMIN');setShopping(m.data?.family?.visibility?.shopping!==false)
    } catch(e) {setError(errorText(e))} finally {setLoading(false)}
  }
  useEffect(()=>{void refresh()},[period])
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),7000);return()=>clearTimeout(t)},[notice])
  const done=(text:string)=>{setNotice(text);void refresh()}
  const rows=categories.filter(c=>(c.transaction_type||'EXPENSE')===kind && c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const ranked:any[]=analytics?.ranked||[]
  const income=Number(analytics?.total_income)||0, expense=Number(analytics?.total_expense)||0
  const createCategory=async(e:FormEvent)=>{
    e.preventDefault();if(saving)return;setSaving(true);setCategoryError('')
    try {const j=await request('/finance/categories','POST',{name:categoryName.trim(),transaction_type:kind});setCategories(c=>[...c,j.data].sort((a,b)=>a.name.localeCompare(b.name,'ru')));setAddingCategory(false);setCategoryName('');setNotice('Категория «'+j.data.name+'» добавлена.')}catch(err){setCategoryError(errorText(err))}finally{setSaving(false)}
  }
  const periodControl=<div className="f-segment" aria-label="Период">{[['month','Месяц'],['3m','3 мес.'],['6m','6 мес.'],['year','Год']].map(([value,label])=><button key={value} aria-pressed={period===value} onClick={()=>{setPeriod(value);setSelected(null)}}>{label}</button>)}</div>
  return <div className="finance-page">
    <div className="section-title"><h2>Финансы</h2><button className="f-icon" aria-label="Обновить финансы" disabled={loading} onClick={()=>void refresh()}>↻</button></div>
    <div className="f-tabs" role="tablist" aria-label="Разделы финансов">{tabs.map(([key,label])=><button role="tab" id={`finance-tab-${key}`} aria-selected={tab===key} aria-controls={`finance-panel-${key}`} key={key} onClick={()=>{setTab(key);setError('');setNotice('')}}>{label}</button>)}</div>
    <Message text={error} error/><Message text={notice}/>
    {loading&&<p className="f-loading" role="status">Обновляем данные…</p>}
    <div role="tabpanel" id={`finance-panel-${tab}`} aria-labelledby={`finance-tab-${tab}`} className="f-stack">
    {tab==='overview'&&<>
      {periodControl}
      <div className="f-metrics"><div><small>Доходы</small><strong className="f-positive">{money(income)}</strong></div><div><small>Расходы</small><strong>{money(expense)}</strong></div><div><small>Остаток</small><strong className={income<expense?'danger':'f-positive'}>{money(income-expense)}</strong></div></div>
      <div className="f-actions"><button className="button primary" onClick={()=>setTx({type:'EXPENSE'})}>＋ Расход</button><button className="button secondary" onClick={()=>setTx({type:'INCOME'})}>＋ Доход</button><Help label="Как добавить расход по чеку" text="Откройте вкладку «Чеки», загрузите фото и подтвердите позиции. Расходы появятся в обзоре автоматически."/></div>
      <section className="card"><Head title="Расходы по категориям"><Help text="Выберите категорию, чтобы посмотреть её операции. Все категории и создание новых — во вкладке «Категории»."/></Head>
        {ranked.length?<><div className="f-expense-total">{money(selected?ranked.find(c=>c.name===selected)?.amount:expense)}</div>{ranked.map(c=><button key={c.id} className="f-category-stat" aria-pressed={selected===c.name} onClick={()=>setSelected(v=>v===c.name?null:c.name)}><span><strong>{c.name}</strong><small>{expense?Math.round(c.amount/expense*100):0}%</small><b>{money(c.amount)}</b></span><span className="f-progress"><i style={{width:`${expense?Math.min(100,c.amount/expense*100):0}%`,background:c.color||'var(--primary)'}}/></span></button>)}</>:<Empty>Расходов за этот период пока нет.</Empty>}
      </section>
      <section className="card"><Head title="Динамика за 6 месяцев"><Help text="Каждая пара столбиков показывает доходы и расходы за месяц. Суммы рассчитываются по сохранённым операциям."/></Head><div className="f-trend">{(analytics?.trend||[]).map((m:any)=>{const max=Math.max(1,...(analytics?.trend||[]).flatMap((x:any)=>[Number(x.income),Number(x.expense)]));return <div key={m.month}><div className="f-trend-bars"><i title={`Доходы: ${money(m.income)}`} style={{height:`${Math.max(0,Number(m.income)/max*100)}%`}}/><i title={`Расходы: ${money(m.expense)}`} style={{height:`${Math.max(0,Number(m.expense)/max*100)}%`}}/></div><small>{m.label}</small><Help label={`Суммы за ${m.label}`} text={`Доходы: ${money(m.income)}. Расходы: ${money(m.expense)}.`}/></div>})}</div><div className="f-legend"><span>● Доходы</span><span>● Расходы</span></div></section>
      <section className="card"><Head title="Операции"><Help text="Показаны последние 20 операций выбранного периода. Добавить доход или расход можно кнопками над обзором."/></Head>{transactions.filter(t=>{
        const d=new Date(t.occurred_on),n=new Date(),start=new Date(n.getFullYear(),period==='year'?0:n.getMonth()-(period==='3m'?2:period==='6m'?5:0),1)
        return d>=start&&d<=new Date(n.getFullYear(),n.getMonth()+1,0,23,59,59)&&(!selected||t.type==='EXPENSE'&&t.category===selected)
      }).slice(0,20).map(t=><div className="f-row" key={t.id}><div className="f-copy"><strong>{t.category}</strong><small>{dateLabel(t.occurred_on)}{t.description?' · '+t.description:''}</small></div><b className={t.type==='INCOME'?'f-positive':''}>{t.type==='INCOME'?'+':'−'}{money(t.amount)}</b></div>)}{!transactions.length&&<Empty>Операций пока нет.</Empty>}</section>
    </>}
    {tab==='categories'&&<section className="card"><Head title="Категории"><Help text={admin?'Здесь создаются категории. Операции вносятся во вкладке «Обзор». Доходы и расходы используют отдельные списки.':'Категории создаёт администратор семьи. Операции можно вносить во вкладке «Обзор».'}/></Head>
      <div className="f-segment"><button aria-pressed={kind==='EXPENSE'} onClick={()=>setKind('EXPENSE')}>Расходы</button><button aria-pressed={kind==='INCOME'} onClick={()=>setKind('INCOME')}>Доходы</button></div>
      <div className="f-search"><input aria-label="Поиск категории" placeholder="Поиск категории" value={search} onChange={e=>setSearch(e.target.value)}/>{admin&&<button className="button secondary" onClick={()=>{setCategoryName('');setCategoryError('');setAddingCategory(true)}}>＋ Категория</button>}</div>
      <div className="f-category-list">{rows.map(c=><div className="f-row" key={c.id}><span className="f-category-icon">{c.icon||'•'}</span><strong className="f-copy">{c.name}</strong><small>{kind==='INCOME'?'Доход':'Расход'}</small></div>)}</div>{!rows.length&&<Empty>Категории не найдены.</Empty>}
    </section>}
    {tab==='receipts'&&<Receipts categories={categories.filter(c=>c.transaction_type==='EXPENSE')} onSaved={done}/>}
    {tab==='stocks'&&<Stocks allowed={shopping}/>}
    {tab==='credits'&&<Credits admin={admin}/>}
    {tab==='budget'&&<Budget categories={categories.filter(c=>c.transaction_type==='EXPENSE')} admin={admin} onSaved={done} periodControl={periodControl} income={income} expense={expense}/>}
    </div>
    {tx&&<Transaction type={tx.type} categories={categories.filter(c=>c.transaction_type===tx.type)} onClose={()=>setTx(null)} onSaved={()=>{setTx(null);done(tx.type==='INCOME'?'Доход сохранён.':'Расход сохранён.')}}/>}
    {addingCategory&&<Modal title={kind==='INCOME'?'Категория дохода':'Категория расхода'} onClose={()=>setAddingCategory(false)} busy={saving}><form className="f-form" onSubmit={createCategory}><Field label="Название"><input required maxLength={80} value={categoryName} onChange={e=>setCategoryName(e.target.value)} autoFocus/></Field><Message text={categoryError} error/><button className="button primary" disabled={saving||!categoryName.trim()}>{saving?'Сохраняем…':'Создать категорию'}</button></form></Modal>}
  </div>
}
function Transaction({type,categories,onClose,onSaved}:{type:Kind;categories:Category[];onClose:()=>void;onSaved:()=>void}) {
  const [amount,setAmount]=useState(''),[category,setCategory]=useState(''),[date,setDate]=useState(today()),[description,setDescription]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  const submit=async(e:FormEvent)=>{e.preventDefault();if(saving)return;setSaving(true);setError('');try{const c=categories.find(c=>c.id===category);if(!c)throw new Error('Выберите категорию.');await request('/finances','POST',{type,amount:Number(amount),category:c.name,category_id:c.id,occurred_on:date,description});onSaved()}catch(e){setError(errorText(e))}finally{setSaving(false)}}
  return <Modal title={type==='INCOME'?'Новый доход':'Новый расход'} onClose={onClose} busy={saving}><form className="f-form" onSubmit={submit}><Field label="Сумма, ₽"><input type="number" inputMode="decimal" required min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} autoFocus/></Field><Field label="Категория"><select required value={category} onChange={e=>setCategory(e.target.value)}><option value="">Выберите категорию</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><div className="f-form-pair"><Field label="Дата"><input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></Field><Field label="Заметка"><input maxLength={255} value={description} onChange={e=>setDescription(e.target.value)}/></Field></div><Message text={error} error/><button className="button primary" disabled={saving}>{saving?'Сохраняем…':type==='INCOME'?'Сохранить доход':'Сохранить расход'}</button></form></Modal>
}

async function preparePhoto(file:File):Promise<string> {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Выберите фото в формате JPEG, PNG или WebP.')
  if(file.size>20*1024*1024)throw new Error('Фото слишком большое. Выберите изображение размером до 20 МБ.')
  const image=await createImageBitmap(file)
  try {const ratio=Math.min(1,2000/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*ratio);canvas.height=Math.round(image.height*ratio);canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.9)}finally{image.close()}
}
function Receipts({categories,onSaved}:{categories:Category[];onSaved:(text:string)=>void}) {
  const [list,setList]=useState<any[]>([]),[receipt,setReceipt]=useState<any>(null),[items,setItems]=useState<Item[]>([])
  const [receiptTotal,setReceiptTotal]=useState(''),[editIndex,setEditIndex]=useState<number|null>(null),[editMeta,setEditMeta]=useState(false)
  const [merchant,setMerchant]=useState(''),[date,setDate]=useState(today()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const refresh=async()=>{try{const j=await request('/finance/receipts');setList(j.data||[])}catch(e){setError(errorText(e))}}
  useEffect(()=>{void refresh()},[])
  const select=(r:any)=>{
    const p=r.review_payload||r.ai_result?.parsed||r.ai_result?.review_payload||{}
    setReceipt(r);setEditIndex(null);setEditMeta(false);setReceiptTotal(p.receipt_total!=null?String(p.receipt_total):p.total!=null?String(p.total):'');setMerchant(p.merchant||'');setDate(p.date||today());setItems((p.items||[]).map((it:any)=>{const c=categories.find(c=>c.id===it.category_id||c.name===it.category)||categories.find(c=>c.name==='Покупки')||categories[0];return {name:it.name||'',qty:Number(it.qty)||0,price:Number(it.price)||0,category:c?.name||'Покупки',category_id:c?.id}}));setError('');setNotice('')
  }
  const upload=async(file:File)=>{if(busy)return;setBusy(true);setError('');try{const image=await preparePhoto(file);const j=await request('/finance/receipts','POST',{file_name:file.name,mime_type:'image/jpeg',image_data:image});select(j.data);await refresh()}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  const open=async(id:string)=>{if(busy)return;setBusy(true);setError('');try{select((await request(`/finance/receipts/${id}`)).data)}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  const update=(index:number,patch:Partial<Item>)=>setItems(rows=>rows.map((r,i)=>i===index?{...r,...patch}:r))
  const total=items.reduce((s,i)=>s+Math.round(i.qty*i.price*100)/100,0),confirmed=receipt?.ocr_status==='CONFIRMED'||receipt?.can_edit===false
  const expected=receiptTotal.trim()===''?null:Number(receiptTotal),balanced=expected!==null&&expected>0&&Math.abs(total-expected)<=0.02,validItems=items.length>0&&items.every(i=>i.name.trim()&&i.qty>0&&i.price>0)
  const save=async(confirm:boolean)=>{
    if(busy||!receipt)return;setBusy(true);setError('');setNotice('')
    try{
      if(confirm&&(!items.length||items.some(i=>!i.name.trim()||i.qty<=0||i.price<=0)))throw new Error('Укажите название, количество и цену для каждой позиции.')
      if(confirm&&!balanced)throw new Error('Сумма позиций не совпадает с итогом чека. Проверьте количество, цены и итог.');
      const payload={merchant,date,total,receipt_total:expected,items}
      const j=await request(`/finance/receipts/${receipt.id}${confirm?'/confirm':''}`,confirm?'POST':'PATCH',payload)
      if(confirm){setReceipt(null);setItems([]);onSaved(`Чек подтверждён. Добавлены расходы на ${money(j.data.total_amount)}.`)}else {setReceipt(j.data);setNotice('Черновик чека сохранён.')}
      await refresh()
    }catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  const retry=async()=>{if(busy)return;setBusy(true);setError('');try{select((await request(`/finance/receipts/${receipt.id}/retry`,'POST',{})).data);await refresh()}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  const status=(r:any)=>r.ocr_status==='CONFIRMED'?'Расходы сохранены':r.ocr_status==='COMPLETED'?'Проверьте позиции':'Нужна проверка'
  const editItem=editIndex===null?null:items[editIndex]
  return <div className="f-stack f-receipts"><section className="card"><Head title={receipt?'Проверка чека':'Чеки'}><div className="f-actions"><Help text="Расходы создаются после проверки позиций. Сумма позиций должна совпадать с итогом на чеке. Для исправления нажмите на карандаш у товара или измените данные чека."/>{receipt&&<button className="f-icon" disabled={busy} aria-label="Закрыть чек" onClick={()=>setReceipt(null)}>×</button>}</div></Head>
    {!receipt&&<label className={`button primary f-upload ${busy?'f-disabled':''}`}>{busy?'Обрабатываем…':'＋ Фото чека'}<input aria-label="Фото чека" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void upload(f)}}/></label>}
    <Message text={error} error/><Message text={notice}/>
    {receipt&&<div className="f-receipt-review">
      <div className="f-receipt-meta"><div className="f-copy"><strong>{merchant||'Чек'} · {dateLabel(date)}</strong><small>На чеке: {expected===null?'итог не указан':money(expected)}</small></div>{!confirmed&&<button className="f-icon" disabled={busy} aria-label="Изменить данные чека" onClick={()=>setEditMeta(true)}>✎</button>}</div>
      {!items.length&&<Message text="Фото сохранено, но позиции не удалось распознать. Повторите распознавание или добавьте позиции вручную."/>}
      <div className="f-receipt-lines">{items.map((it,index)=><div className="f-receipt-line" key={index}>
        <span className="f-line-index">{index+1}</span><div className="f-copy"><strong>{it.name||'Без названия'}</strong><small>{it.qty>0?it.qty:'?'} × {money(it.price)} · {it.category}</small></div><div className="f-line-end"><b>{money(Math.round(it.qty*it.price*100)/100)}</b>{!confirmed&&<button className="f-icon" aria-label={`Изменить позицию ${index+1}`} disabled={busy} onClick={()=>setEditIndex(index)}>✎</button>}</div>
      </div>)}</div>
      {!confirmed&&<div className="f-receipt-tools"><button className="button ghost" disabled={busy} onClick={()=>{setItems(rows=>[...rows,{name:'',qty:1,price:0,category:categories.find(c=>c.name==='Покупки')?.name||categories[0]?.name||'Покупки',category_id:categories.find(c=>c.name==='Покупки')?.id||categories[0]?.id}]);setEditIndex(items.length)}}>＋ Позиция</button><button className="button ghost" disabled={busy} onClick={()=>void retry()}>{busy?'Распознаём…':'Распознать ещё раз'}</button></div>}
      <div className="f-receipt-total"><div><span>Итого по позициям</span><b>{money(total)}</b></div><small className={balanced?'f-positive':'danger'}>{balanced?'Сумма совпадает с чеком':expected===null?'Укажите итог в данных чека':`На чеке ${money(expected)} — проверьте позиции`}</small></div>
      {!confirmed&&<div className="f-receipt-submit"><button className="button primary" disabled={busy||!validItems||!balanced} onClick={()=>void save(true)}>{busy?'Сохраняем…':'Подтвердить расходы'}</button><button className="button ghost" disabled={busy} onClick={()=>void save(false)}>Черновик</button></div>}
    </div>}
  </section>
  <section className="card"><Head title="История чеков"/>{list.length?list.map(r=><button key={r.id} className="f-row f-history" disabled={busy} onClick={()=>void open(r.id)}><div className="f-copy"><strong>{r.review_payload?.merchant||r.file_name||'Чек'}</strong><small>{dateLabel(r.created_at)} · {status(r)}</small></div><span>›</span></button>):<Empty>Загруженных чеков пока нет.</Empty>}</section>
  {editItem&&editIndex!==null&&<Modal title={`Позиция ${editIndex+1}`} onClose={()=>setEditIndex(null)}><div className="f-form"><Field label={`Товар ${editIndex+1}`}><textarea rows={3} maxLength={255} value={editItem.name} onChange={e=>update(editIndex,{name:e.target.value})}/></Field><div className="f-receipt-quantity-price"><Field label="Количество"><input type="number" inputMode="decimal" min="0.001" step="0.001" value={editItem.qty} onChange={e=>update(editIndex,{qty:Number(e.target.value)})}/></Field><Field label="Цена, ₽"><input type="number" inputMode="decimal" min="0.01" step="0.01" value={editItem.price} onChange={e=>update(editIndex,{price:Number(e.target.value)})}/></Field></div><Field label="Категория"><select value={editItem.category_id||''} onChange={e=>{const c=categories.find(c=>c.id===e.target.value)!;update(editIndex,{category:c.name,category_id:c.id})}}>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><div className="f-actions"><button className="button primary" onClick={()=>setEditIndex(null)}>Готово</button><button className="button ghost danger" onClick={()=>{setItems(rows=>rows.filter((_,i)=>i!==editIndex));setEditIndex(null)}}>Удалить позицию</button></div></div></Modal>}
  {editMeta&&<Modal title="Данные чека" onClose={()=>setEditMeta(false)}><div className="f-form"><Field label="Магазин"><input maxLength={255} value={merchant} onChange={e=>setMerchant(e.target.value)}/></Field><Field label="Дата покупки"><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field><Field label="Итог на чеке, ₽"><input type="number" inputMode="decimal" min="0.01" step="0.01" value={receiptTotal} onChange={e=>setReceiptTotal(e.target.value)}/></Field><button className="button primary" onClick={()=>setEditMeta(false)}>Готово</button></div></Modal>}
  </div>
}
function Stocks({allowed}:{allowed:boolean}) {
  const [items,setItems]=useState<any[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const refresh=async()=>{if(!allowed){setLoading(false);return}setLoading(true);setError('');try{setItems((await request('/planned-purchases?type=RECURRING')).data||[])}catch(e){setError(errorText(e))}finally{setLoading(false)}}
  useEffect(()=>{void refresh()},[allowed])
  return <section className="card"><Head title="Регулярные покупки"><Help text="Товары, периодичность и отметки о покупке ведутся в разделе «Покупки» → «Регулярные». Здесь показаны даты следующей покупки из того же списка."/></Head><Message text={error} error/>{loading?<Empty>Загружаем товары…</Empty>:!allowed?<Empty>Доступ к разделу «Покупки» ограничен администратором.</Empty>:items.length?items.map(i=><div key={i.id} className="f-row"><div className="f-copy"><strong>{i.name}</strong><small>{i.last_purchased_at?'Куплено '+dateLabel(i.last_purchased_at):'Покупок ещё не было'}</small></div><div className="f-number"><b>{dateLabel(i.due_date)}</b><small>Следующая покупка</small></div></div>):<Empty>Регулярных покупок пока нет.</Empty>}{error&&<button className="button secondary" onClick={()=>void refresh()}>Повторить загрузку</button>}</section>
}
function Credits({admin}:{admin:boolean}) {
  const [credits,setCredits]=useState<any[]>([]),[selected,setSelected]=useState(''),[adding,setAdding]=useState(false)
  const [date,setDate]=useState(today()),[amount,setAmount]=useState(''),[mode,setMode]=useState('TERM')
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const refresh=async()=>{setLoading(true);try{const j=await request('/credits');setCredits(j.data||[])}catch(e){setError(errorText(e))}finally{setLoading(false)}}
  useEffect(()=>{void refresh()},[])
  const credit=credits.find(c=>c.id===selected)||credits[0]
  const submit=async(e:FormEvent)=>{e.preventDefault();if(busy||!credit)return;setBusy(true);setError('');setNotice('');try{await request(`/credits/${credit.id}/prepayments`,'POST',{paid_on:date,amount:Number(amount),recalculation_mode:mode});setAmount('');setNotice('Досрочный платёж сохранён.');await refresh()}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  const updateMode=async(id:string,value:string)=>{if(busy)return;setBusy(true);setError('');try{await request(`/credit-prepayments/${id}`,'PATCH',{recalculation_mode:value});await refresh();setNotice('Назначение платежа изменено.')}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  return <div className="f-stack"><Message text={error} error/><Message text={notice}/><section className="card"><Head title="Кредиты и рассрочки">{admin?<button className="button secondary" onClick={()=>setAdding(true)}>＋ Добавить</button>:<Help text="Кредиты и досрочные платежи добавляет администратор семьи."/>}</Head>
    {loading&&!credits.length?<Empty>Загружаем кредиты…</Empty>:credits.length?<div className="f-credit-list">{credits.map(c=><button key={c.id} className="f-credit" aria-pressed={credit?.id===c.id} onClick={()=>{setSelected(c.id);setMode(c.recalculation_mode);setError('');setNotice('')}}><strong>{c.name||'Кредит'}</strong><small>{c.type==='INSTALLMENT'?'Рассрочка':'Кредит'} · {Number(c.annual_rate)}% · {c.term_months} мес.</small><span><small>Сумма по договору</small><b>{money(c.principal)}</b></span><span><small>Платёж в месяц</small><b>{money(c.standard_payment)}</b></span></button>)}</div>:<Empty>Кредиты и рассрочки пока не добавлены.</Empty>}
    {credit&&<div className="f-row"><span>Первый платёж</span><b>{dateLabel(credit.first_payment_date)}</b></div>}
  </section>
  {credit&&admin&&<section className="card"><Head title="Досрочный платёж"><Help text="Укажите фактическую дату и сумму платежа, затем выберите уменьшение срока или платежа. Запись сохраняется в карточке кредита. Расходы в бюджете учитываются отдельно во вкладке «Обзор»."/></Head><form className="f-form" onSubmit={submit}><div className="f-form-pair"><Field label="Дата платежа"><input type="date" required min={credit.start_date?.slice(0,10)} max={today()} value={date} onChange={e=>setDate(e.target.value)}/></Field><Field label="Сумма, ₽"><input type="number" inputMode="decimal" required min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></Field></div><Field label="Назначение"><select value={mode} onChange={e=>setMode(e.target.value)}><option value="TERM">Уменьшить срок</option><option value="PAYMENT">Уменьшить платёж</option></select></Field><button className="button primary" disabled={busy}>{busy?'Сохраняем…':'Сохранить платёж'}</button></form></section>}
  {credit&&<section className="card"><Head title="Досрочные платежи"><span className="f-count">{credit.prepayments?.length||0}</span></Head>{credit.prepayments?.length?credit.prepayments.map((p:any)=><div className="f-prepayment" key={p.id}><time dateTime={p.paid_on}>{dateLabel(p.paid_on)}</time><b>{money(p.amount)}</b>{admin?<Field label="Назначение"><select aria-label={`Назначение платежа от ${dateLabel(p.paid_on)}`} value={p.recalculation_mode||credit.recalculation_mode} disabled={busy} onChange={e=>void updateMode(p.id,e.target.value)}><option value="TERM">Уменьшить срок</option><option value="PAYMENT">Уменьшить платёж</option></select></Field>:<small>{(p.recalculation_mode||credit.recalculation_mode)==='TERM'?'Уменьшить срок':'Уменьшить платёж'}</small>}</div>):<Empty>Досрочных платежей пока нет.</Empty>}</section>}
  {adding&&<AddCredit onClose={()=>setAdding(false)} onSaved={id=>{setAdding(false);setSelected(id);setNotice('Кредит сохранён.');void refresh()}}/>}
  </div>
}
function AddCredit({onClose,onSaved}:{onClose:()=>void;onSaved:(id:string)=>void}) {
  const [form,setForm]=useState({type:'CREDIT',name:'',principal:'',annual_rate:'',standard_payment:'',term_months:'',start_date:today(),first_payment_date:today(),recalculation_mode:'TERM'})
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const field=(key:keyof typeof form,value:string)=>setForm(f=>({...f,[key]:value}))
  const submit=async(e:FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const j=await request('/credits','POST',{...form,principal:Number(form.principal),annual_rate:form.type==='INSTALLMENT'?0:Number(form.annual_rate),standard_payment:Number(form.standard_payment),term_months:Number(form.term_months)});onSaved(j.data.id)}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  return <Modal title="Новый кредит или рассрочка" onClose={onClose} busy={busy}><form className="f-form" onSubmit={submit}><Field label="Тип"><select value={form.type} onChange={e=>field('type',e.target.value)}><option value="CREDIT">Кредит</option><option value="INSTALLMENT">Рассрочка</option></select></Field><Field label="Название"><input autoFocus required maxLength={120} placeholder="Например, рассрочка на технику" value={form.name} onChange={e=>field('name',e.target.value)}/></Field><div className="f-form-pair"><Field label="Сумма, ₽"><input type="number" required min="0.01" step="0.01" value={form.principal} onChange={e=>field('principal',e.target.value)}/></Field><Field label="Срок, месяцев"><input type="number" required min="1" max="600" step="1" value={form.term_months} onChange={e=>field('term_months',e.target.value)}/></Field></div><div className="f-form-pair">{form.type==='CREDIT'&&<Field label="Ставка, % годовых"><input type="number" required min="0" max="100" step="0.0001" value={form.annual_rate} onChange={e=>field('annual_rate',e.target.value)}/></Field>}<Field label="Платёж в месяц, ₽"><input type="number" required min="0.01" step="0.01" value={form.standard_payment} onChange={e=>field('standard_payment',e.target.value)}/></Field></div><div className="f-form-pair"><Field label="Дата договора"><input type="date" required value={form.start_date} onChange={e=>field('start_date',e.target.value)}/></Field><Field label="Первый платёж"><input type="date" required min={form.start_date} value={form.first_payment_date} onChange={e=>field('first_payment_date',e.target.value)}/></Field></div><Field label="При досрочном погашении"><select value={form.recalculation_mode} onChange={e=>field('recalculation_mode',e.target.value)}><option value="TERM">Уменьшать срок</option><option value="PAYMENT">Уменьшать платёж</option></select></Field><Message text={error} error/><button className="button primary" disabled={busy}>{busy?'Сохраняем…':'Сохранить кредит'}</button></form></Modal>
}
function Budget({categories,admin,onSaved,income,expense}:{categories:Category[];admin:boolean;onSaved:(s:string)=>void;periodControl:ReactNode;income:number;expense:number}) {
  const [month,setMonth]=useState(today().slice(0,7)),[budget,setBudget]=useState<any>(null),[limit,setLimit]=useState(''),[limits,setLimits]=useState<Record<string,string>>({})
  const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false)
  const load=async()=>{setLoaded(false);setError('');try{const [year,m]=month.split('-');const j=await request(`/finance/budgets/${year}/${Number(m)}`),b=j.data?.budget;setBudget(b);setLimit(String(b?.total_limit||''));setLimits(Object.fromEntries((b?.categories||[]).map((c:any)=>[c.category_id,String(c.limit_amount)])))}catch(e){setError(errorText(e))}finally{setLoaded(true)}}
  useEffect(()=>{void load()},[month])
  const save=async(e:FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await request('/finance/budgets/save','POST',{year:Number(month.slice(0,4)),month:Number(month.slice(5,7)),total_limit:Number(limit),categories:Object.entries(limits).filter(([,value])=>value!=='').map(([category_id,value])=>({category_id,limit_amount:Number(value)}))});setEditing(false);await load();onSaved('Лимиты бюджета сохранены.')}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  return <div className="f-stack"><section className="card"><Head title="Бюджет на месяц"><Help text="Лимиты задаются здесь. Доходы, расходы и чеки вносятся в соответствующих вкладках. Общий лимит и лимиты категорий настраивает администратор."/></Head><Field label="Месяц"><input type="month" required value={month} onChange={e=>{if(e.target.value){setMonth(e.target.value);setEditing(false)}}}/></Field><Message text={error} error/>{!loaded?<Empty>Загружаем бюджет…</Empty>:<><div className="f-row"><span>Общий лимит</span><b>{money(budget?.total_limit)}</b></div><div className="f-row"><span>Потрачено за месяц</span><b>{money(budget?.spent_amount)}</b></div><div className="f-row"><span>Доступно в лимите</span><b className={budget?.available_amount<0?'danger':'f-positive'}>{money(budget?.available_amount)}</b></div>{admin&&!editing&&<button className="button secondary" onClick={()=>setEditing(true)}>Настроить лимиты</button>}
    {editing&&<form className="f-form" onSubmit={save}><Field label="Общий лимит, ₽"><input type="number" min="0" step="0.01" required value={limit} onChange={e=>setLimit(e.target.value)}/></Field>{categories.map(c=><Field key={c.id} label={c.name}><input aria-label={`Лимит: ${c.name}`} type="number" min="0" step="0.01" value={limits[c.id]||''} onChange={e=>setLimits(values=>({...values,[c.id]:e.target.value}))}/></Field>)}<div className="f-actions"><button className="button primary" disabled={busy}>{busy?'Сохраняем…':'Сохранить лимиты'}</button><button type="button" className="button ghost" disabled={busy} onClick={()=>{setEditing(false);void load()}}>Отмена</button></div></form>}
    {(budget?.categories||[]).map((c:any)=><div className="f-row" key={c.category_id}><strong className="f-copy">{c.name}</strong><div className="f-number"><b>{money(c.spent_amount)}</b><small>из {money(c.limit_amount)}</small></div></div>)}</>}
  </section><section className="card"><Head title="Выбранный период обзора"><Help text="Эти суммы соответствуют периоду, выбранному во вкладке «Обзор». Лимиты выше всегда относятся к выбранному месяцу бюджета."/></Head><div className="f-row"><span>Доходы</span><b>{money(income)}</b></div><div className="f-row"><span>Расходы</span><b>{money(expense)}</b></div><div className="f-row"><span>Остаток</span><b>{money(income-expense)}</b></div></section></div>
}
