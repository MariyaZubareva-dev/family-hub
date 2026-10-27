export const DEFAULT_TIMEZONE='Europe/Moscow'
const cities:Record<string,string>={'Europe/Moscow':'Москва','Europe/Kaliningrad':'Калининград','Europe/Samara':'Самара','Asia/Yekaterinburg':'Екатеринбург','Asia/Omsk':'Омск','Asia/Novosibirsk':'Новосибирск','Asia/Krasnoyarsk':'Красноярск','Asia/Irkutsk':'Иркутск','Asia/Yakutsk':'Якутск','Asia/Vladivostok':'Владивосток','Asia/Magadan':'Магадан','Asia/Kamchatka':'Камчатка','Europe/Warsaw':'Варшава','Europe/London':'Лондон','UTC':'UTC'}
export function zoneParts(date:Date,zone=DEFAULT_TIMEZONE){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date)
  const value=(type:string)=>Number(parts.find(p=>p.type===type)?.value)
  return {year:value('year'),month:value('month'),day:value('day'),hour:value('hour'),minute:value('minute')}
}
export function zoneInput(date:Date,zone=DEFAULT_TIMEZONE){const p=zoneParts(date,zone),pad=(v:number)=>String(v).padStart(2,'0');return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`}
export function wallTimeToDate(value:string,zone=DEFAULT_TIMEZONE){
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if(!match)throw new Error('Укажите дату и время.')
  const [y,m,d,h,min]=match.slice(1).map(Number),target=Date.UTC(y,m-1,d,h,min)
  let guess=target
  for(let i=0;i<4;i++){const p=zoneParts(new Date(guess),zone);const delta=target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);if(!delta)break;guess+=delta}
  const result=new Date(guess)
  if(zoneInput(result,zone)!==value)throw new Error('В этом часовом поясе такого времени нет из-за перевода часов. Выберите другое время.')
  return result
}
export function timezoneLabel(zone:string){return (cities[zone]||zone)+' · '+zone}
const supported=(Intl as typeof Intl&{supportedValuesOf?:(key:string)=>string[]}).supportedValuesOf?.('timeZone')||[]
export const TIMEZONES=[DEFAULT_TIMEZONE,...Array.from(new Set([...Object.keys(cities),...supported])).filter(x=>x!==DEFAULT_TIMEZONE)]
