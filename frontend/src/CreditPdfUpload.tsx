import {useEffect,useRef,useState} from 'react'
import {Field,request} from './FinanceScreen'
type Row={date:string;payment:number;principal:number;interest:number;fees:number;balance:number}
type Extracted={rows:{date:string;values:number[]}[];column_count:number;pages:number;source:string;warnings:string[];skipped_lines:number;today?:string}
const money=(value:number)=>value.toLocaleString('ru-RU',{maximumFractionDigits:2})
const readPdf=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve('data:application/pdf;base64,'+String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Не удалось прочитать PDF. Выберите файл ещё раз.'));reader.readAsDataURL(file)})
export default function CreditPdfUpload({creditId,disabled,onBusy,onImported,incomingFile}:{creditId:string;disabled:boolean;onBusy:(value:boolean)=>void;onImported:(rows:Row[],opening:number,asOf?:string)=>void;incomingFile?:File|null}){
  const consumed=useRef<File|null>(null)
  const [data,setData]=useState<Extracted|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const [mapping,setMapping]=useState({payment:-1,principal:-1,interest:-1,fees:-2,balance:-1})
  const upload=async(file:File)=>{
    if(disabled||loading)return
    setError('')
    if(file.size>8*1024*1024){setError('Выберите PDF размером до 8 МБ.');return}
    setLoading(true);onBusy(true)
    try{const result=await request(`/credits/${creditId}/bank-schedule/import-pdf`,'POST',{pdf_data:await readPdf(file)});setData(result.data);setMapping({payment:-1,principal:-1,interest:-1,fees:-2,balance:-1})}catch(e){setError(e instanceof Error?e.message:'Не удалось прочитать PDF.')}finally{setLoading(false);onBusy(false)}
  }
  useEffect(()=>{if(incomingFile&&consumed.current!==incomingFile){consumed.current=incomingFile;void upload(incomingFile)}},[incomingFile])
  const apply=()=>{
    if(!data)return
    setError('')
    const used=Object.values(mapping).filter(value=>value>=0)
    if(used.length!==new Set(used).size){setError('Для разных сумм выберите разные столбцы.');return}
    const rows:Row[]=data.rows.map(row=>({date:row.date,...Object.fromEntries(Object.entries(mapping).map(([field,index])=>[field,index===-2?0:row.values[index]]))} as Row))
    const opening=Math.round((rows[0].principal+rows[0].balance)*100)/100
    let balance=opening,previous=''
    for(let i=0;i<rows.length;i++){
      const row=rows[i]
      if(Object.values(row).some(v=>v===undefined)||row.date<=previous||Math.abs(row.payment-row.principal-row.interest-row.fees)>.021||Math.abs(balance-row.principal-row.balance)>.021){setError(`Строка ${i+1}: суммы или даты не сходятся. Проверьте сопоставление столбцов. Ничего не сохранено.`);return}
      balance=row.balance;previous=row.date
    }
    const today=data.today||new Date().toLocaleDateString('sv-SE')
    let boundary=-1
    for(let i=0;i<rows.length;i++)if(rows[i].date<=today)boundary=i
    // A complete bank schedule may include origination and payments already made.
    const origin=rows[0].payment===0&&rows[0].principal===0&&rows[0].interest===0&&rows[0].fees===0
    const start=Math.max(boundary+1,origin?1:0)
    const future=rows.slice(start)
    if(!future.length){setError('В PDF нет будущих платежей. Загрузите актуальный график банка.');return}
    onImported(future,Math.round((future[0].principal+future[0].balance)*100)/100,start>0?rows[start-1].date:undefined);setData(null)
  }
  return <div className="credit-pdf-import">
    <Field label="Загрузить PDF"><input type="file" accept=".pdf,application/pdf" disabled={disabled||loading} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file)}}/></Field>
    {loading&&<div className="credit-pdf-loading" role="status"><span className="credit-pdf-spinner" aria-hidden="true"/>Извлекаем график из PDF…</div>}
    {error&&<p role="alert" className="f-message f-error">{error}</p>}
    {data&&<section role="region" className="credit-pdf-review" aria-label="Проверка PDF"><div className="f-head"><h3>Сопоставьте столбцы</h3><button type="button" className="f-icon" aria-label="Отменить импорт PDF" onClick={()=>{setData(null);setError('')}}>×</button></div><p className="f-empty">{data.rows.length} строк · {data.pages} стр. · {data.source==='PDF_TEXT'?'текст PDF':'распознавание скана'}</p>{data.warnings.map(warning=><p className="credit-pdf-note" key={warning}>{warning}</p>)}{data.skipped_lines>0&&<p className="credit-pdf-note">Не выделено строк с датами: {data.skipped_lines}. Сверьте количество платежей с PDF и добавьте пропуски вручную.</p>}
      <div className="credit-table-scroll" tabIndex={0} aria-label="Извлечённые суммы PDF"><table className="credit-table"><thead><tr><th>Дата</th>{Array.from({length:data.column_count},(_,i)=><th key={i}>Столбец {i+1}</th>)}</tr></thead><tbody>{data.rows.slice(0,5).map((row,i)=><tr key={i}><td>{row.date}</td>{row.values.map((value,j)=><td key={j}>{money(value)}</td>)}</tr>)}</tbody></table></div>
      <div className="f-form-fields">{([['payment','Платёж'],['principal','Основной долг'],['interest','Проценты'],['fees','Услуги'],['balance','Остаток после платежа']] as const).map(([key,label])=><Field key={key} label={label}><select aria-label={label} value={mapping[key]} onChange={e=>setMapping({...mapping,[key]:Number(e.target.value)})}><option value={-1} disabled>Выберите столбец</option>{(key==='fees'||key==='interest')&&<option value={-2}>Отсутствуют · 0 ₽</option>}{Array.from({length:data.column_count},(_,i)=><option value={i} key={i}>Столбец {i+1} · {money(data.rows[0].values[i])} ₽</option>)}</select></Field>)}</div>
      <button type="button" className="button secondary" disabled={Object.values(mapping).includes(-1)} onClick={apply}>Перенести в график</button>
    </section>}
  </div>
}
