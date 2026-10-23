export type CashbackEntry={category:string;rate:number|string;reward_unit:'RUB'|'POINTS'|'MILES'|'UNKNOWN';active:boolean;cap_amount:number|string|null;notes:string|null;valid_from?:string|null;valid_to?:string|null}
export type CashbackBank={id:string;bank_name:string;bank_key:string;month:string;created_by:string;revision:number;entries:CashbackEntry[];can_edit:boolean;creator?:{first_name?:string;last_name?:string;username?:string}|null}
export type CashbackRow=CashbackEntry&{bank:CashbackBank;index:number}
export const ownerName=(bank:CashbackBank)=>[bank.creator?.first_name,bank.creator?.last_name].filter(Boolean).join(' ').trim()||(bank.creator?.username?'@'+bank.creator.username:'Автор не указан')
export const categoryKey=(name:string)=>name.trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ')
export function bankKey(name:string){const key=categoryKey(name).replace(/[^\p{L}\p{N}]/gu,'');return ({тинькофф:'тбанк',тинькоффбанк:'тбанк',tbank:'тбанк',tinkoff:'тбанк',альфа:'альфабанк',alfabank:'альфабанк',сбер:'сбербанк',sber:'сбербанк',vtb:'втб',ozon:'ozonбанк',озон:'ozonбанк',озонбанк:'ozonбанк',ozonbank:'ozonбанк',яндекс:'яндексбанк',yandex:'яндексбанк',yandexbank:'яндексбанк'} as Record<string,string>)[key]||key}
export const unitLabel=(unit:CashbackEntry['reward_unit'])=>({RUB:'рублями',POINTS:'баллами',MILES:'милями',UNKNOWN:'тип не указан'}[unit])
export const flattenCashback=(banks:CashbackBank[]):CashbackRow[]=>banks.flatMap(bank=>bank.entries.map((entry,index)=>({...entry,bank,index})))
export const isCurrentCashback=(entry:CashbackRow,today:string)=>entry.active&&entry.bank.month===today.slice(0,7)&&(!entry.valid_from||entry.valid_from<=today)&&(!entry.valid_to||entry.valid_to>=today)&&entry.cap_amount!==0&&entry.cap_amount!=='0'
export function bestCashback(rows:CashbackRow[],today:string,includeNonCash=false){
  const groups=new Map<string,CashbackRow>()
  for(const row of rows.filter(row=>isCurrentCashback(row,today)&&(includeNonCash||row.reward_unit==='RUB')).sort((a,b)=>Number(b.rate)-Number(a.rate)||a.bank.bank_name.localeCompare(b.bank.bank_name,'ru')||a.bank.id.localeCompare(b.bank.id))){const key=categoryKey(row.category);if(!groups.has(key))groups.set(key,row)}
  return [...groups.values()]
}
export function mergeCashback(base:CashbackEntry[],added:CashbackEntry[]){
  const rows=new Map<string,CashbackEntry>()
  for(const entry of base)if(entry.category.trim())rows.set(categoryKey(entry.category),{...entry})
  for(const entry of added)if(entry.category.trim()){
    const key=categoryKey(entry.category),previous=rows.get(key)
    rows.set(key,{...entry,reward_unit:entry.reward_unit==='UNKNOWN'&&previous?previous.reward_unit:entry.reward_unit,cap_amount:entry.cap_amount??previous?.cap_amount??null,notes:entry.notes||previous?.notes||null,valid_from:entry.valid_from||previous?.valid_from||null,valid_to:entry.valid_to||previous?.valid_to||null})
  }
  return [...rows.values()]
}
