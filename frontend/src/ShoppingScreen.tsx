import { useEffect, useState, type FormEvent } from 'react'
import { Field, Modal } from './FinanceScreen'
import './shopping.css'

type Kind = 'LARGE'|'RECURRING'
type Category = {id:string;name:string}
type Purchase = {id:string;type:Kind;name:string;category?:string;estimated_amount?:string;due_date?:string;cadence_months?:number;creator?:{first_name?:string;username?:string}}
const money=(n:unknown)=>`${Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽`
const localDate=()=>new Date().toLocaleDateString('sv-SE')
const dateLabel=(s:string)=>new Date(s.slice(0,10)+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'})
async function request(path:string,body?:unknown){
  const headers:Record<string,string>={Accept:'application/json','Content-Type':'application/json'}
  const initData=(window as any).Telegram?.WebApp?.initData
  if(initData)headers['X-Telegram-Init-Data']=initData
  else headers['X-Dev-Telegram-User-Id']=localStorage.getItem('dev_telegram_id')||'999001'
  let response:Response
  try{response=await fetch('/api/v1/planned-purchases'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)})}
  catch{throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.')}
  const json=await response.json().catch(()=>null)
  if(!response.ok){
    if(response.status===401)throw new Error('Откройте приложение заново через Telegram.')
    if(response.status===403)throw new Error('Нет доступа к покупкам этой семьи. Обратитесь к администратору.')
    if(response.status>=500)throw new Error('Сервер временно недоступен. Попробуйте ещё раз позже.')
    const message=Object.values(json?.errors||{}).flat()[0]||json?.message
    if(typeof message==='string'&&/[а-яё]/i.test(message)&&!/SQLSTATE|Exception|<|>/.test(message))throw new Error(message)
    throw new Error(response.status===422?'Проверьте название, сумму и даты. Данные пока не сохранены.':'Не удалось выполнить действие. Попробуйте ещё раз.')
  }
  return json
}
const errorText=(e:unknown)=>e instanceof Error?e.message:'Не удалось выполнить действие. Попробуйте ещё раз.'

export default function ShoppingScreen(){
  const [items,setItems]=useState<Purchase[]>([]),[categories,setCategories]=useState<Category[]>([])
  const [type,setType]=useState<Kind>('LARGE'),[show,setShow]=useState(false),[loading,setLoading]=useState(true)
  const [name,setName]=useState(''),[category,setCategory]=useState(''),[amount,setAmount]=useState(''),[due,setDue]=useState(''),[cadence,setCadence]=useState('3')
  const [addingCategory,setAddingCategory]=useState(false),[categoryName,setCategoryName]=useState(''),[categoryError,setCategoryError]=useState('')
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[formError,setFormError]=useState(''),[notice,setNotice]=useState('')
  const refresh=async()=>{
    setLoading(true);setError('')
    try{const [p,c]=await Promise.all([request(''),request('/categories')]);setItems(p.data||[]);setCategories(c.data||[])}
    catch(e){setError(errorText(e))}finally{setLoading(false)}
  }
  useEffect(()=>{void refresh()},[])
  const open=()=>{setName('');setCategory('');setAmount('');setDue('');setCadence('3');setFormError('');setAddingCategory(false);setCategoryName('');setCategoryError('');setShow(true)}
  const addCategory=async()=>{
    if(busy)return
    if(!categoryName.trim()){setCategoryError('Введите название категории.');return}
    setBusy('category');setCategoryError('')
    try{const j=await request('/categories',{name:categoryName.trim()});setCategories(c=>[...c.filter(x=>x.id!==j.data.id),j.data].sort((a,b)=>a.name.localeCompare(b.name,'ru')));setCategory(j.data.name);setAddingCategory(false);setCategoryName('')}
    catch(e){setCategoryError(errorText(e))}finally{setBusy('')}
  }
  const add=async(e:FormEvent)=>{
    e.preventDefault();if(busy||addingCategory)return
    if(!name.trim()){setFormError('Введите название покупки.');return}
    setBusy('save');setFormError('')
    try{const j=await request('',{type,name:name.trim(),category:category||undefined,estimated_amount:amount!==''?Number(amount):undefined,due_date:due||undefined,cadence_months:type==='RECURRING'?Number(cadence):undefined,notify_days_before:7});setItems(p=>[...p,j.data]);setShow(false);setNotice('Покупка «'+j.data.name+'» добавлена.')}
    catch(e){setFormError(errorText(e))}finally{setBusy('')}
  }
  const mark=async(item:Purchase)=>{
    if(busy)return;setBusy(item.id);setError('')
    try{const j=await request('/'+item.id+'/purchased',{purchased_on:localDate()});setItems(p=>p.map(x=>x.id===item.id?j.data:x));setNotice('Покупка «'+item.name+'» отмечена. Следующая дата: '+dateLabel(j.data.due_date)+'.')}
    catch(e){setError(errorText(e))}finally{setBusy('')}
  }
  const shown=items.filter(x=>x.type===type).sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999'))
  return <div className="shopping-page">
    <div className="section-title"><h2>Покупки</h2><button className="s-icon" aria-label="Обновить покупки" disabled={loading||!!busy} onClick={()=>void refresh()}>↻</button></div>
    <div className="s-tabs" role="tablist" aria-label="Виды покупок">{([['LARGE','Крупные и подарки'],['RECURRING','Регулярные']] as [Kind,string][]).map(([value,label])=><button key={value} id={'shopping-tab-'+value} role="tab" aria-selected={type===value} aria-controls="shopping-list" onClick={()=>{setType(value);setNotice('')}}>{label}</button>)}</div>
    {error&&<div className="s-message s-error" role="alert">{error}</div>}
    {notice&&<div className="s-message" role="status">{notice}<button className="s-icon" aria-label="Закрыть уведомление" onClick={()=>setNotice('')}>×</button></div>}
    {loading&&<p className="s-empty" role="status">Загружаем покупки…</p>}
    <section className="card" id="shopping-list" role="tabpanel" aria-labelledby={'shopping-tab-'+type}>
      <div className="s-head"><h3>{type==='LARGE'?'Крупные покупки и подарки':'Регулярные покупки'} <span className="s-count">{shown.length}</span></h3><button className="s-add" onClick={open} disabled={loading}>＋ Добавить</button></div>
      {shown.map(x=><article className="s-item" key={x.id}>
        <span className="s-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={type==='LARGE'?'M4 7h16v14H4z M8 7V5a4 4 0 0 1 8 0v2':'M4 8a8 8 0 0 1 13-3l3 3 M20 3v5h-5 M20 16a8 8 0 0 1-13 3l-3-3 M4 21v-5h5'}/></svg></span>
        <div className="s-copy"><strong>{x.name}</strong><small>{x.category||'Без категории'}{x.cadence_months?` · каждые ${x.cadence_months} мес.`:''}</small><small>{x.due_date?dateLabel(x.due_date):'Дата не задана'}{x.creator?.first_name||x.creator?.username?` · ${x.creator.first_name||x.creator.username}`:''}</small></div>
        <div className="s-end"><b>{x.estimated_amount!=null?money(x.estimated_amount):'Сумма не задана'}</b>{type==='RECURRING'&&<button className="button secondary" disabled={!!busy} onClick={()=>void mark(x)} aria-label={'Отметить покупку: '+x.name}>{busy===x.id?'Сохраняем…':'Купили'}</button>}</div>
      </article>)}
      {!loading&&!error&&!shown.length&&<p className="s-empty">{type==='LARGE'?'Добавьте покупку или подарок, который планируете.':'Добавьте товары, которые покупаете регулярно.'}</p>}
    </section>
    {show&&<Modal title={type==='LARGE'?'Добавить покупку или подарок':'Добавить регулярную покупку'} onClose={()=>setShow(false)} busy={!!busy}>
      <form className="f-form" onSubmit={add}>
        <div className="f-form-fields">
          <Field label="Название"><input value={name} onChange={e=>setName(e.target.value)} required maxLength={255} placeholder="Что купить" disabled={!!busy}/></Field>
          <Field label="Категория"><select value={category} onChange={e=>{if(e.target.value==='__new__'){setAddingCategory(true);setCategoryError('')}else{setCategory(e.target.value);setAddingCategory(false)}}} disabled={!!busy}><option value="__new__">＋ Добавить новую категорию</option><option value="">Без категории</option>{categories.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</select></Field>
          <Field label="Сумма, ₽"><input type="number" min="0" max="999999999999.99" step="0.01" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Не задана" disabled={!!busy}/></Field>
          <Field label={type==='LARGE'?'Плановая дата':'Следующая дата'}><input type="date" value={due} onChange={e=>setDue(e.target.value)} required={type==='RECURRING'} disabled={!!busy}/></Field>
          {type==='RECURRING'&&<Field label="Каждые, мес."><input type="number" min="1" max="120" step="1" inputMode="numeric" value={cadence} onChange={e=>setCadence(e.target.value)} required disabled={!!busy}/></Field>}
        </div>
        {addingCategory&&<div className="s-new-category">
          <div className="f-form-fields"><Field label="Новая категория"><input aria-label="Название новой категории" autoFocus value={categoryName} maxLength={120} placeholder="Например, Для дома" onChange={e=>setCategoryName(e.target.value)} disabled={!!busy} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void addCategory()}}}/></Field></div>
          {categoryError&&<div className="s-message s-error" role="alert">{categoryError}</div>}
          <div className="f-actions"><button type="button" className="button secondary" onClick={()=>{setAddingCategory(false);setCategoryError('')}} disabled={!!busy}>Отмена категории</button><button type="button" className="button primary" disabled={!!busy} onClick={()=>void addCategory()}>{busy==='category'?'Добавляем…':'Добавить категорию'}</button></div>
        </div>}
        {formError&&<div className="s-message s-error" role="alert">{formError}</div>}
        <div className="f-actions"><button type="button" className="button secondary" onClick={()=>setShow(false)} disabled={!!busy}>Отмена</button><button className="button primary" disabled={!!busy||addingCategory}>{busy==='save'?'Сохраняем…':'Сохранить'}</button></div>
      </form>
    </Modal>}
  </div>
}
