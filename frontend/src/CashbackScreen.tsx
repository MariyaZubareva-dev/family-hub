import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Field, Help, Modal, request } from './FinanceScreen'
import { bankKey, bestCashback, categoryKey, flattenCashback, isCurrentCashback, mergeCashback, ownerName, unitLabel, type CashbackBank, type CashbackEntry, type CashbackRow } from './lib/cashback'
import './cashback.css'

const endpoint='/finance/cashback-banks'
const emptyEntry=():CashbackEntry=>({category:'',rate:'',reward_unit:'RUB',active:false,cap_amount:null,notes:null,valid_from:null,valid_to:null})
const failure=(e:unknown)=>e instanceof Error?e.message:'Не удалось сохранить кешбэк. Попробуйте ещё раз.'
const monthLabel=(month:string)=>new Date(month+'-15T12:00:00').toLocaleDateString('ru-RU',{month:'long',year:'numeric'})
type Draft={bank_name:string;month:string;entries:CashbackEntry[];record?:CashbackBank}
type Meta={month:string;today:string;user_id:string}
const readImage=(file:File)=>new Promise<string>((resolve,reject)=>{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024){reject(new Error('Выберите PNG, JPEG или WebP размером до 5 МБ.'));return}
  const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Не удалось прочитать изображение. Выберите файл ещё раз.'));reader.readAsDataURL(file)
})

function CashbackTable({rows,onOpen,label,winners=new Set<string>()}:{rows:CashbackRow[];onOpen:(row:CashbackRow)=>void;label:string;winners?:Set<string>}){
  const [direction,setDirection]=useState<'ascending'|'descending'|null>(null)
  const sorted=direction?[...rows].sort((a,b)=>(Number(a.rate)-Number(b.rate))*(direction==='ascending'?1:-1)):rows
  const sortLabel='Сортировать по проценту кешбэка: '+(direction==='descending'?'сначала меньший':'сначала больший')
  return <table className="cb-compact-table" aria-label={label}><colgroup><col className="cb-col-category"/><col className="cb-col-rate"/><col className="cb-col-owner"/></colgroup><thead><tr><th scope="col">Категория / банк</th><th scope="col" aria-sort={direction||'none'}><button type="button" className="cb-sort" aria-label={sortLabel} title={sortLabel} onClick={()=>setDirection(value=>value==='descending'?'ascending':'descending')}>Кешбэк<svg aria-hidden="true" width="10" height="12" viewBox="0 0 10 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d={direction==='descending'?'M5 1v10 M2 8l3 3 3-3':direction==='ascending'?'M5 11V1 M2 4l3-3 3 3':'M3 10V2 M1 4l2-2 2 2 M7 2v8 M5 8l2 2 2-2'}/></svg></button></th><th scope="col">Владелец</th></tr></thead><tbody>{sorted.map(row=><tr key={row.bank.id+':'+row.index}>
    <td><button className="cb-table-open" aria-label={`Подробнее: ${row.category}, ${row.bank.bank_name}, ${ownerName(row.bank)}`} onClick={()=>onOpen(row)}><strong>{row.category}</strong><small>{row.bank.bank_name}</small></button></td>
    <td className={'cb-table-rate'+(winners.has(row.bank.id+':'+row.index)?' cb-table-best':'')}><b>{Number(row.rate).toLocaleString('ru-RU')}%</b>{row.reward_unit!=='RUB'&&<small>{unitLabel(row.reward_unit)}</small>}</td>
    <td className="cb-table-owner">{ownerName(row.bank)}</td>
  </tr>)}</tbody></table>
}

export function CashbackSummary({onOpen}:{onOpen:()=>void}){
  const [banks,setBanks]=useState<CashbackBank[]>([]),[meta,setMeta]=useState<Meta|null>(null),[mine,setMine]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0)
  useEffect(()=>{let active=true;setLoading(true);setError('');request(endpoint).then(j=>{if(active){setBanks(j.data||[]);setMeta(j.meta||null)}}).catch(e=>{if(active)setError(failure(e))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[retry])
  const best=meta?bestCashback(flattenCashback(banks.filter(bank=>!mine||bank.created_by===meta.user_id)),meta.today,true).sort((a,b)=>categoryKey(a.category).localeCompare(categoryKey(b.category),'ru')):[]
  return <section className="card cb-summary" aria-label="Где выгоднее кешбэк"><div className="h-head"><h3>Где выгоднее кешбэк</h3><button className="h-link" onClick={onOpen}>Весь кешбэк →</button></div>
    <div className="cb-summary-tools"><div className="f-segment">{[false,true].map(value=><button key={String(value)} aria-pressed={mine===value} onClick={()=>setMine(value)}>{value?'Мои банки':'Вся семья'}</button>)}</div><Help label="Как сравнивается кешбэк" text="Показаны все подтверждённые действующие категории. При совпадении названий оставляем максимальный процент. Баллы и мили подписаны отдельно и не переведены в рубли. Лимиты и условия могут изменить выгоду; их остаток по скриншоту неизвестен. Категория продавца определяется банком по MCC, а не по товарам в чеке. Добавить категории можно в Финансах → Кешбэк."/></div>
    {loading?<p className="h-empty" role="status">Загружаем кешбэк…</p>:error?<div className="h-error" role="alert">{error}<button className="button secondary" onClick={()=>setRetry(n=>n+1)}>Повторить</button></div>:best.length?<CashbackTable rows={best} onOpen={onOpen} label="Лучшие ставки кешбэка"/>:<p className="h-empty">Подтверждённых действующих категорий на этот месяц пока нет.</p>}
  </section>
}

export default function CashbackScreen({initialFiles,onConsumed}:{initialFiles?:File[]|null;onConsumed?:()=>void}){
  const [month,setMonth]=useState(''),[meta,setMeta]=useState<Meta|null>(null),[banks,setBanks]=useState<CashbackBank[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [mine,setMine]=useState(false),[bank,setBank]=useState(''),[search,setSearch]=useState('')
  const [showAll,setShowAll]=useState(false)
  const [inspecting,setInspecting]=useState<CashbackRow|null>(null)
  const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[formError,setFormError]=useState(''),[review,setReview]=useState(false),[deleting,setDeleting]=useState<CashbackBank|null>(null)
  const [importNotice,setImportNotice]=useState('')
  const generation=useRef(0),consumed=useRef<File[]|null>(null)
  const load=async()=>{
    const version=++generation.current;setLoading(true);setError('')
    try{const j=await request(endpoint+(month?'?month='+month:''));if(version===generation.current){setBanks(j.data||[]);setMeta(j.meta);if(!month&&j.meta?.month)setMonth(j.meta.month)}}catch(e){if(version===generation.current)setError(failure(e))}finally{if(version===generation.current)setLoading(false)}
  }
  useEffect(()=>{void load();return()=>{generation.current++}},[month])
  const currentMonth=month||meta?.month||''
  const findExisting=(name:string)=>banks.find(row=>row.created_by===meta?.user_id&&bankKey(row.bank_name)===bankKey(name)&&row.month===currentMonth)
  const start=(record?:CashbackBank)=>{setFormError('');setImportNotice('');setNotice('');setReview(false);setDraft(record?{record,bank_name:record.bank_name,month:record.month,entries:record.entries.map(x=>({...x}))}:{bank_name:'',month:currentMonth,entries:[emptyEntry()]})}
  const importFiles=async(files:File[],existing?:Draft|null)=>{
    if(busy)return
    if(files.length>5){(existing?setFormError:setError)('За один раз можно загрузить до 5 скриншотов одного банка.');return}
    let work:Draft=existing?{...existing,entries:existing.entries.map(x=>({...x}))}:{bank_name:'',month:currentMonth,entries:[]}
    setDraft(work);setBusy(true);setFormError('');setImportNotice('');setReview(false)
    const messages:string[]=[],problems:string[]=[]
    try{
      for(let i=0;i<files.length;i++){
        setProgress(`Распознаём скриншот ${i+1} из ${files.length}…`)
        try{
          const image=await readImage(files[i]);const j=await request(endpoint+'/recognize','POST',{image_data:image});const result=j.data
          if(result.bank_name&&work.bank_name&&bankKey(result.bank_name)!==bankKey(work.bank_name)){problems.push('Скриншоты разных банков добавляйте отдельно. Данные другого банка пропущены.');continue}
          if(!work.bank_name&&result.bank_name)work.bank_name=result.bank_name
          const saved=!work.record&&work.bank_name?findExisting(work.bank_name):undefined
          if(saved){work.record=saved;work.entries=mergeCashback(saved.entries,work.entries)}
          work.entries=mergeCashback(work.entries,(result.entries||[]).map((entry:CashbackEntry)=>({...entry,active:false})))
          if(result.message)messages.push(result.message)
          setDraft({...work,entries:[...work.entries]})
        }catch(e){problems.push(failure(e))}
      }
    }finally{
      if(!work.entries.length)work.entries=[emptyEntry()]
      setDraft({...work,entries:[...work.entries]});setImportNotice([...new Set(messages)].join(' '));setFormError([...new Set(problems)].join(' '));setBusy(false);setProgress('')
    }
  }
  useEffect(()=>{
    if(!initialFiles?.length||loading||error||!meta||consumed.current===initialFiles)return
    consumed.current=initialFiles;void importFiles(initialFiles);onConsumed?.()
  },[initialFiles,loading,error,meta])
  const changeEntry=(index:number,patch:Partial<CashbackEntry>)=>{setReview(false);setDraft(d=>d?{...d,entries:d.entries.map((entry,i)=>i===index?{...entry,...patch}:entry)}:d)}
  const matchExisting=()=>{if(!draft||draft.record)return;const saved=findExisting(draft.bank_name);if(saved)setDraft({...draft,record:saved,bank_name:saved.bank_name,entries:mergeCashback(saved.entries,draft.entries)})}
  const save=async(e:FormEvent)=>{
    e.preventDefault();if(!draft||busy)return
    setFormError('')
    if(!review){setFormError('Проверьте данные и подтвердите это галочкой перед сохранением.');return}
    if(draft.entries.some(entry=>entry.reward_unit==='UNKNOWN')){setFormError('Укажите тип вознаграждения для каждой категории: рубли, баллы или мили.');return}
    setBusy(true)
    try{
      const payload={bank_name:draft.bank_name.trim(),month:draft.month,revision:draft.record?.revision,entries:draft.entries.map(entry=>({...entry,category:entry.category.trim(),rate:Number(entry.rate),cap_amount:entry.cap_amount===''||entry.cap_amount===null?null:Number(entry.cap_amount)}))}
      await request(endpoint+(draft.record?'/'+draft.record.id:''),draft.record?'PATCH':'POST',payload)
      setDraft(null);setNotice('Категории кешбэка сохранены.');await load()
    }catch(e){setFormError(failure(e))}finally{setBusy(false)}
  }
  const remove=async()=>{
    if(!deleting||busy)return;setBusy(true);setFormError('')
    try{await request(endpoint+'/'+deleting.id,'DELETE',{revision:deleting.revision});setDeleting(null);setDraft(null);setNotice('Категории банка за этот месяц удалены.');await load()}catch(e){setFormError(failure(e))}finally{setBusy(false)}
  }
  const filtered=banks.filter(row=>(!mine||row.created_by===meta?.user_id)&&(!bank||bankKey(row.bank_name)===bank))
  const eligible=(row:CashbackRow)=>!!meta&&(row.bank.month===meta.today.slice(0,7)?isCurrentCashback(row,meta.today):row.active&&Number(row.cap_amount??1)>0)
  const rows=flattenCashback(filtered).filter(row=>(showAll||eligible(row))&&(row.category+' '+row.bank.bank_name+' '+ownerName(row.bank)).toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a,b)=>categoryKey(a.category).localeCompare(categoryKey(b.category),'ru')||Number(eligible(b))-Number(eligible(a))||Number(b.reward_unit==='RUB')-Number(a.reward_unit==='RUB')||Number(b.rate)-Number(a.rate))
  const winners=new Set(meta?bestCashback(flattenCashback(filtered),meta.today).map(row=>row.bank.id+':'+row.index):[])
  return <div className="cb-page">
    <section className="card"><div className="f-head"><h3>Кешбэк семьи</h3><Help label="Как пользоваться кешбэком" text="Добавьте название банка и скриншоты выбранных категорий. Автор станет владельцем записи. Все участники с доступом к Финансам видят сводку; изменить её может автор или администратор. Лучшей отмечаем ставку в рублях среди действующих выбранных категорий. Лимит, MCC и условия банка проверяйте перед оплатой. Баллы и мили сравнивайте отдельно."/></div>
      <div className="cb-filters"><Field label="Месяц кешбэка"><input type="month" value={currentMonth} disabled={loading||busy} onChange={e=>{if(e.target.value){setMonth(e.target.value);setBank('')}}}/></Field><Field label="Владелец"><select value={mine?'mine':'all'} onChange={e=>setMine(e.target.value==='mine')}><option value="all">Вся семья</option><option value="mine">Только мои банки</option></select></Field></div>
      <div className="f-actions cb-top-actions"><label className="button primary cb-upload" aria-disabled={loading||busy}>Загрузить скриншоты<input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={loading||busy||!meta} aria-label="Загрузить скриншоты кешбэка" onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void importFiles(files)}}/></label><button className="button secondary" disabled={loading||busy||!meta} onClick={()=>start()}>＋ Вручную</button></div>
      {notice&&<p className="f-message" role="status">{notice}</p>}{error&&<div className="f-message f-error" role="alert">{error}<button className="button secondary" onClick={()=>void load()}>Повторить</button></div>}
    </section>
    <section className="card"><div className="f-head"><h3>Сводка по категориям</h3><button className="f-icon" aria-label="Обновить кешбэк" disabled={loading||busy} onClick={()=>void load()}>↻</button></div>
      <div className="cb-filters"><Field label="Поиск кешбэка"><input type="search" placeholder="Категория, банк или имя" value={search} onChange={e=>setSearch(e.target.value)}/></Field><Field label="Банк в сводке"><select value={bank} onChange={e=>setBank(e.target.value)}><option value="">Все банки</option>{Array.from(new Map(banks.map(row=>[bankKey(row.bank_name),row.bank_name])).entries()).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></Field></div>
      <div className="f-segment" aria-label="Статус категорий кешбэка"><button aria-pressed={!showAll} onClick={()=>setShowAll(false)}>{meta&&currentMonth!==meta.today.slice(0,7)?'Выбранные':'Действующие'}</button><button aria-pressed={showAll} onClick={()=>setShowAll(true)}>Все</button></div>
      {loading?<p className="f-loading" role="status">Загружаем категории…</p>:rows.length?<CashbackTable rows={rows} onOpen={setInspecting} label="Категории кешбэка" winners={winners}/>:<p className="f-empty">{banks.length?'По этим фильтрам категорий нет. Другие предложения доступны в режиме «Все».':'Добавьте банк и категории кешбэка на выбранный месяц.'}</p>}
    </section>
    {inspecting&&<Modal title="Условия кешбэка" onClose={()=>setInspecting(null)}><div className="f-form"><div className="cb-offer-detail"><strong>{inspecting.category} · {Number(inspecting.rate).toLocaleString('ru-RU')}% {unitLabel(inspecting.reward_unit)}</strong><p>{inspecting.bank.bank_name} · {ownerName(inspecting.bank)}</p><p>{!inspecting.active?'Категория не выбрана в банке.':!eligible(inspecting)?'Сейчас не действует.':'Категория выбрана в банке.'}</p><p>{inspecting.valid_from||inspecting.bank.month+'-01'} — {inspecting.valid_to||new Date(Number(inspecting.bank.month.slice(0,4)),Number(inspecting.bank.month.slice(5,7)),0).toLocaleDateString('sv-SE')}</p><p>{inspecting.cap_amount===null?'Лимит не указан':`Лимит вознаграждения: ${inspecting.cap_amount} ${inspecting.reward_unit==='RUB'?'₽':inspecting.reward_unit==='POINTS'?'баллов':'миль'}`}. Остаток лимита неизвестен.</p>{inspecting.notes&&<p>{inspecting.notes}</p>}</div>{inspecting.bank.can_edit&&<button className="button secondary" onClick={()=>{const record=inspecting.bank;setInspecting(null);start(record)}}>Изменить категории банка</button>}</div></Modal>}
    {draft&&<Modal title={draft.record?'Изменить кешбэк банка':'Добавить кешбэк банка'} onClose={()=>{setDraft(null);setFormError('')}} busy={busy}><form className="f-form cb-editor" onSubmit={save}>
      {importNotice&&<p className="f-message" role="status">{importNotice}</p>}
      <fieldset disabled={busy}><div className="f-form-fields"><Field label="Название банка"><input list="cb-bank-names" required maxLength={100} value={draft.bank_name} readOnly={!!draft.record} onBlur={matchExisting} onChange={e=>{setReview(false);setDraft({...draft,bank_name:e.target.value})}}/><datalist id="cb-bank-names">{['Т-Банк','Альфа-Банк','Сбербанк','ВТБ','Газпромбанк','Ozon Банк','Яндекс Банк','Совкомбанк','Райффайзен Банк'].map(name=><option key={name} value={name}/>)}</datalist></Field><div className="cb-period"><span>{monthLabel(draft.month)}</span><Help label="Как изменить месяц кешбэка" text="Месяц выбирается над списком банков. Закройте это окно и выберите нужный месяц перед добавлением. Убедитесь, что на скриншоте показан тот же период."/></div></div>
      {draft.record&&<p className="cb-note">Обновление сохранённых категорий: {ownerName(draft.record)}. Категории из скриншотов объединены с текущим списком; проверьте изменения.</p>}
      <label className="button secondary cb-upload">Добавить скриншоты<input type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Добавить скриншоты в черновик" disabled={busy} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void importFiles(files,draft)}}/></label>
      <div className="cb-draft-items">{draft.entries.map((entry,index)=><section className="cb-draft-item" key={index} aria-label={`Категория кешбэка ${index+1}`}><div className="cb-entry-top"><strong>Категория {index+1}</strong><button type="button" className="cb-delete" aria-label={`Убрать категорию ${index+1}`} onClick={()=>{setReview(false);setDraft({...draft,entries:draft.entries.filter((_,i)=>i!==index)})}}>Убрать</button></div>
        <div className="cb-entry-main"><Field label="Категория банка"><input required maxLength={120} value={entry.category} onChange={e=>changeEntry(index,{category:e.target.value})}/></Field><Field label="Кешбэк, %"><input required type="number" inputMode="decimal" min="0.01" max="100" step="0.01" value={entry.rate} onChange={e=>changeEntry(index,{rate:e.target.value})}/></Field></div>
        <Field label="Вознаграждение"><select value={entry.reward_unit} onChange={e=>changeEntry(index,{reward_unit:e.target.value as CashbackEntry['reward_unit']})}><option value="UNKNOWN" disabled>Укажите тип</option><option value="RUB">Рубли</option><option value="POINTS">Баллы</option><option value="MILES">Мили</option></select></Field>
        <label className="cb-check"><input type="checkbox" checked={entry.active} onChange={e=>changeEntry(index,{active:e.target.checked})}/><span>Категория выбрана в банке</span></label>
        <details className="cb-entry-details"><summary>Лимит и условия</summary><Field label="Лимит вознаграждения"><input type="number" inputMode="decimal" min="0" step="0.01" placeholder="Не указан" value={entry.cap_amount??''} onChange={e=>changeEntry(index,{cap_amount:e.target.value===''?null:e.target.value})}/></Field><div className="cb-filters"><Field label="Действует с"><input type="date" value={entry.valid_from||''} onChange={e=>changeEntry(index,{valid_from:e.target.value||null})}/></Field><Field label="Действует до"><input type="date" value={entry.valid_to||''} onChange={e=>changeEntry(index,{valid_to:e.target.value||null})}/></Field></div><Field label="Условия банка"><textarea rows={2} maxLength={500} value={entry.notes||''} placeholder="Например, только онлайн или при оплате картой" onChange={e=>changeEntry(index,{notes:e.target.value||null})}/></Field></details>
      </section>)}</div>
      <button type="button" className="button secondary" disabled={draft.entries.length>=60} onClick={()=>{setReview(false);setDraft({...draft,entries:[...draft.entries,emptyEntry()]})}}>＋ Категория</button>
      <label className="cb-check cb-confirm"><input type="checkbox" checked={review} onChange={e=>setReview(e.target.checked)}/><span>Проверены банк, месяц, проценты и выбранные категории</span></label></fieldset>
      {progress&&<p className="f-loading" role="status">{progress}</p>}{formError&&<p className="f-message f-error" role="alert">{formError}</p>}
      <div className="f-actions">{draft.record&&<button type="button" className="button ghost danger" disabled={busy} onClick={()=>{setFormError('');setDeleting(draft.record!)}}>Удалить за месяц</button>}<button className="button primary" disabled={busy||!review||!draft.entries.length}>{busy?'Подождите…':'Сохранить категории'}</button></div>
    </form></Modal>}
    {deleting&&<Modal title="Удалить кешбэк банка?" onClose={()=>setDeleting(null)} busy={busy}><div className="f-form"><p>{deleting.bank_name} · {ownerName(deleting)} · {monthLabel(deleting.month)}. Записи других месяцев сохранятся.</p>{formError&&<p className="f-message f-error" role="alert">{formError}</p>}<div className="f-actions"><button className="button secondary" disabled={busy} onClick={()=>setDeleting(null)}>Отмена</button><button className="button primary f-danger-button" disabled={busy} onClick={()=>void remove()}>Удалить категории</button></div></div></Modal>}
  </div>
}
