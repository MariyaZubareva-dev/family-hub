import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Field, Help, Modal, request } from './FinanceScreen'

type Item={id:string;name:string;quantity?:string|null;notes?:string|null;is_completed:boolean;recurring_purchase_id?:string|null;recurring_due_date?:string|null}
const endpoint='/planned-purchases/store-items'
const errorText=(e:unknown)=>e instanceof Error?e.message:'Не удалось сохранить изменения. Попробуйте ещё раз.'

export default function StoreList({refreshVersion,onBusyChange}:{refreshVersion:number;onBusyChange:(busy:boolean)=>void}){
  const [items,setItems]=useState<Item[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
  const [error,setError]=useState(''),[formError,setFormError]=useState(''),[show,setShow]=useState(false),[editing,setEditing]=useState<Item|null>(null),[deleting,setDeleting]=useState<Item|null>(null)
  const [name,setName]=useState(''),[quantity,setQuantity]=useState(''),[notes,setNotes]=useState('')
  const revision=useRef(0)
  const load=async()=>{
    const version=revision.current
    try{const j=await request(endpoint);if(version===revision.current){setItems(j.data||[]);setError('')}}catch(e){if(version===revision.current)setError(errorText(e))}finally{if(version===revision.current)setLoading(false)}
  }
  useEffect(()=>{void load();return()=>{revision.current++}},[refreshVersion])
  useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false)},[busy,onBusyChange])
  useEffect(()=>{
    if(busy||show)return
    const refresh=()=>{if(document.visibilityState==='visible')void load()}
    const timer=window.setInterval(refresh,30000);window.addEventListener('focus',refresh)
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh)}
  },[busy,show])
  const open=(item:Item|null)=>{revision.current++;setEditing(item);setName(item?.name||'');setQuantity(item?.quantity||'');setNotes(item?.notes||'');setFormError('');setShow(true)}
  const save=async(e:FormEvent)=>{
    e.preventDefault();if(busy||!name.trim())return
    revision.current++;setBusy(true);setFormError('')
    try{const j=await request(endpoint+(editing?'/'+editing.id:''),editing?'PATCH':'POST',{name:name.trim(),quantity:quantity.trim()||null,notes:notes.trim()||null});setItems(rows=>editing?rows.map(x=>x.id===editing.id?j.data:x):[j.data,...rows]);setShow(false)}catch(e){setFormError(errorText(e))}finally{setBusy(false)}
  }
  const toggle=async(item:Item)=>{
    if(busy)return;revision.current++;setBusy(true);setError('')
    try{const j=await request(endpoint+'/'+item.id,'PATCH',{is_completed:!item.is_completed});setItems(rows=>rows.map(x=>x.id===item.id?j.data:x))}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  const remove=async()=>{
    if(busy||!deleting)return;revision.current++;setBusy(true);setFormError('')
    try{await request(endpoint+'/'+deleting.id,'DELETE');setItems(rows=>rows.filter(x=>x.id!==deleting.id));setDeleting(null);setShow(false)}catch(e){setFormError(errorText(e))}finally{setBusy(false)}
  }
  const pending=items.filter(x=>!x.is_completed),done=items.filter(x=>x.is_completed)
  const row=(item:Item)=><article className={'s-store-item'+(item.is_completed?' s-store-done':'')} key={item.id}>
    <label className="s-store-check"><input type="checkbox" aria-label={'Куплено: '+item.name} checked={!!item.is_completed} disabled={busy} onChange={()=>void toggle(item)}/><span className="s-copy"><span className="s-store-title"><strong>{item.name}</strong>{item.quantity&&<span className="s-store-quantity">{item.quantity}</span>}</span>{item.notes&&<small>{item.notes}</small>}{item.recurring_purchase_id&&<small>Из регулярных покупок</small>}</span></label>
    <button className="s-icon" aria-label={'Изменить товар: '+item.name} disabled={busy} onClick={()=>open(item)}>✎</button>
  </article>
  return <>
    <section className="card" id="shopping-list" role="tabpanel" aria-labelledby="shopping-tab-STORE">
      <div className="s-head"><h3>Магазин <span className="s-count" aria-live="polite">Купить: {pending.length}</span></h3><div className="f-actions"><Help label="Как работает список магазина" text="Добавляйте товары для поездки в магазин и отмечайте купленное. Регулярные покупки появляются автоматически в свою дату по часовому поясу семьи. Галочка переносит следующую закупку регулярного товара. Снятие галочки отменяет перенос, если расписание после этого не меняли. Название, количество и заметка редактируются только для этого списка. Расходы фиксируются в Финансах или по чеку."/><button className="s-add" disabled={loading||busy} onClick={()=>open(null)}>＋ Добавить</button></div></div>
      {error&&<div className="s-message s-error" role="alert">{error}<button className="s-add" disabled={busy} onClick={()=>void load()}>Повторить</button></div>}
      {loading?<p className="s-empty" role="status">Загружаем список…</p>:pending.length?pending.map(row):<p className="s-empty">{done.length?'Всё куплено. Можно добавить новые товары.':'Добавьте товары для поездки в магазин.'}</p>}
      {done.length>0&&<details className="s-store-completed"><summary>Куплено ({done.length})</summary>{done.map(row)}</details>}
    </section>
    {show&&<Modal title={editing?'Изменить товар':'Добавить товар'} onClose={()=>setShow(false)} busy={busy}><form className="f-form" onSubmit={save}><div className="f-form-fields"><Field label="Название"><input required maxLength={255} value={name} placeholder="Например, Молоко" onChange={e=>setName(e.target.value)}/></Field><Field label="Количество"><input maxLength={80} value={quantity} placeholder="Например, 2 л" onChange={e=>setQuantity(e.target.value)}/></Field><Field label="Заметка"><textarea rows={2} maxLength={500} value={notes} placeholder="Марка, размер или пожелания" onChange={e=>setNotes(e.target.value)}/></Field></div>{formError&&!deleting&&<div className="s-message s-error" role="alert">{formError}</div>}<div className="f-actions">{editing&&<button type="button" className="button ghost danger" disabled={busy} onClick={()=>{setFormError('');setDeleting(editing)}}>Удалить товар</button>}<button className="button primary" disabled={busy||!name.trim()}>{busy?'Сохраняем…':'Сохранить'}</button></div></form></Modal>}
    {deleting&&<Modal title="Удалить товар?" onClose={()=>setDeleting(null)} busy={busy}><div className="f-form"><p>«{deleting.name}» будет удалён из списка магазина.</p>{formError&&<div className="s-message s-error" role="alert">{formError}</div>}<div className="f-actions"><button className="button secondary" disabled={busy} onClick={()=>setDeleting(null)}>Отмена</button><button className="button primary f-danger-button" disabled={busy} onClick={()=>void remove()}>{busy?'Удаляем…':'Удалить товар'}</button></div></div></Modal>}
  </>
}
