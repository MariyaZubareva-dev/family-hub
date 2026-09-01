import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { del, get, patch, post } from './lib/api';
import type { Credit, CreditPrepayment, EventItem, Family, FamilyList, FinanceSummary, FinanceTransaction, Idea, ListItem, MeResponse, Note, Reminder } from './types/domain';
import { initTelegram } from './lib/telegram';
import './styles.css';

type Section='home'|'calendar'|'lists'|'more'|'finance'|'notes'|'ideas';
type FinanceTab='overview'|'budget'|'annual'|'savings'|'large'|'debt';
type FinanceForm={type:'INCOME'|'EXPENSE';amount:string;category:string;budget_type:'FIXED'|'FLEXIBLE'|'FUTURE';description:string;occurred_on:string};
type LargeExpense={name:string;cost:number;months:number;kind:'NECESSITY'|'WANT'};
type PaymentScheduleInputItem={from_month:number;to_month:number;amount:string};
type PaymentScheduleItem={from_month:number;to_month:number;amount:number};
type CreditForm={name:string;principal:string;annual_rate:string;standard_payment:string;term_months:string;start_date:string;first_payment_date:string;recalculation_mode:'TERM'|'PAYMENT';payment_schedule:PaymentScheduleInputItem[]};
type ScheduleRow={month:number;dueDate:string;payment:number;interest:number;principal:number;prepayment:number;prepaymentInterest:number;prepaymentPrincipal:number;totalPaid:number;balance:number;newPayment?:number;paymentChangeDate?:string;newEndDate?:string;prepaymentDates?:string[];status:'PAID'|'FUTURE';};

const TG_ID=423597651;
const todayString=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const emptyEvent=()=>({title:'',description:'',date:todayString(),startTime:'10:00',endTime:'11:00',location:'',responsible_member_id:'',participant_member_ids:[] as string[]});
const emptyCredit=():CreditForm=>({name:'Ипотека',principal:'',annual_rate:'',standard_payment:'',term_months:'360',start_date:todayString(),first_payment_date:addMonths(todayString(),1,new Date().getDate()),recalculation_mode:'TERM',payment_schedule:[{from_month:1,to_month:360,amount:''}]});
const ANNUAL_CATEGORIES=[['Жилье','FIXED'],['Повседневные расходы','FLEXIBLE'],['Транспортные расходы','FLEXIBLE'],['Развлечения','FLEXIBLE'],['Здоровье','FIXED'],['Путешествия/поездки','WANT'],['Отдых и восстановление','WANT'],['Подписки','FIXED'],['Личное','WANT'],['Финансы','FUTURE']] as const;
const RU_MONTHS=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
function num(v:string|number):number{const n=typeof v==='number'?v:Number(String(v).replace(',','.'));return Number.isFinite(n)?n:0;}
function rub(v:number):string{return `${v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₽`;}
function addMonths(base:string,months:number,day:number){const d=new Date(`${base}T00:00:00`);const target=new Date(d.getFullYear(),d.getMonth()+months,1);const last=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();return `${target.getFullYear()}-${String(target.getMonth()+1).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`;}
function addMonthsFromDate(base:string,months:number){const d=new Date(`${base}T00:00:00`);return addMonths(base,months,d.getDate());}
function annuity(principal:number,annualRate:number,months:number){const r=annualRate/100/12;return r>0&&months>0?principal*r/(1-Math.pow(1+r,-months)):months>0?principal/months:0;}
function monthsForPayment(balance:number,annualRate:number,payment:number){if(balance<=0)return 0;const r=annualRate/100/12;if(payment<=0)return Infinity;if(r===0)return Math.ceil(balance/payment);if(payment<=balance*r)return Infinity;return Math.ceil(-Math.log(1-balance*r/payment)/Math.log(1+r));}
function payoffDate(start:string,paymentDay:number,balance:number,annualRate:number,payment:number){const months=monthsForPayment(balance,annualRate,payment);return Number.isFinite(months)?addMonths(start,months,paymentDay):undefined;}
function payoffDateFromPaymentDate(paymentDate:string,balance:number,annualRate:number,payment:number){const months=monthsForPayment(balance,annualRate,payment);return Number.isFinite(months)?addMonthsFromDate(paymentDate,months):undefined;}
function isLeapYear(year:number){return year%4===0&&(year%100!==0||year%400===0);}
function daysInYearValue(year:number){return isLeapYear(year)?366:365;}
function dailyAccruedInterest(balance:number,annualRate:number,fromDate:string,toDate:string){
 if(toDate<=fromDate||balance<=0||annualRate<=0)return 0;
 let cursor=new Date(`${fromDate}T00:00:00`);
 const end=new Date(`${toDate}T00:00:00`);
 let interest=0;
 while(cursor<end){
   cursor=new Date(cursor.getTime()+86400000);
   interest+=balance*(annualRate/100)/daysInYearValue(cursor.getFullYear());
 }
 return interest;
}
function roundMoney(v:number):number{return Math.round((v+Number.EPSILON)*100)/100;}

export default function App(){
 const [section,setSection]=useState<Section>('home');
 const [me,setMe]=useState<MeResponse|null>(null); const [family,setFamily]=useState<Family|null>(null); const [events,setEvents]=useState<EventItem[]>([]); const [reminders,setReminders]=useState<Reminder[]>([]); const [lists,setLists]=useState<FamilyList[]>([]); const [notes,setNotes]=useState<Note[]>([]); const [ideas,setIdeas]=useState<Idea[]>([]); const [finance,setFinance]=useState<{data:FinanceTransaction[];summary:FinanceSummary}|null>(null); const [credits,setCredits]=useState<Credit[]>([]);
 const [busy,setBusy]=useState(true); const [error,setError]=useState<string|null>(null); const [eventForm,setEventForm]=useState(emptyEvent()); const [showEvent,setShowEvent]=useState(false); const [selectedEvent,setSelectedEvent]=useState<EventItem|null>(null); const [newItem,setNewItem]=useState(''); const [newNote,setNewNote]=useState({title:'',body:''}); const [newIdea,setNewIdea]=useState({title:'',description:''}); const [newFinance,setNewFinance]=useState<FinanceForm>({type:'EXPENSE',amount:'',category:'',budget_type:'FLEXIBLE',description:'',occurred_on:todayString()});
 const reload=async()=>{setBusy(true);setError(null);try{const [m,f,e,r,l,n,i]=await Promise.all([get<{data:MeResponse}>('/me'),get<{data:Family}>('/family'),get<{data:EventItem[]}>('/events'),get<{data:Reminder[]}>('/reminders'),get<{data:FamilyList[]}>('/lists'),get<{data:Note[]}>('/notes'),get<{data:Idea[]}>('/ideas')]);setMe(m.data);setFamily(f.data);setEvents(e.data);setReminders(r.data);setLists(l.data);setNotes(n.data);setIdeas(i.data);if(f.data.my_role==='ADMIN'){const [fin,cr]=await Promise.all([get<{data:FinanceTransaction[];summary:FinanceSummary}>('/finances'),get<{data:Credit[]}>('/credits')]);setFinance(fin);setCredits(cr.data);}}catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить данные.')}finally{setBusy(false)}};
 useEffect(()=>{initTelegram();void reload()},[]);
 const activeList=lists[0]; const today=todayString(); const todayEvents=useMemo(()=>events.filter(e=>e.start_at.startsWith(today)),[events,today]); const todayReminders=useMemo(()=>reminders.filter(r=>r.scheduled_at.startsWith(today)),[reminders,today]);
 const createEvent=async()=>{try{setBusy(true);const start=`${eventForm.date}T${eventForm.startTime}:00`;const end=`${eventForm.date}T${eventForm.endTime}:00`;await post('/events',{title:eventForm.title,description:eventForm.description||null,start_at:start,end_at:end,timezone:me?.timezone??'Europe/Moscow',location:eventForm.location||null,responsible_member_id:eventForm.responsible_member_id,participant_member_ids:eventForm.participant_member_ids});setShowEvent(false);setEventForm(emptyEvent());await reload()}catch(e){setError(e instanceof Error?e.message:'Не удалось создать событие.')}finally{setBusy(false)}};
 const createReminder=async()=>{const title=window.prompt('Название напоминания');if(!title||!family)return;try{await post('/reminders',{title,scheduled_at:`${today}T18:00:00`,timezone:me?.timezone??'Europe/Moscow',responsible_member_id:family.members[0]?.id});await reload()}catch(e){setError(e instanceof Error?e.message:'Не удалось создать напоминание.')}};
 const addItem=async()=>{if(!activeList||!newItem.trim())return;try{await post(`/lists/${activeList.id}/items`,{title:newItem.trim()});setNewItem('');await reload()}catch(e){setError(e instanceof Error?e.message:'Не удалось добавить пункт.')}};
 const toggleItem=async(item:ListItem)=>{try{await patch(`/lists/${activeList?.id}/items/${item.id}`,{is_completed:!item.is_completed});await reload()}catch(e){setError(e instanceof Error?e.message:'Не удалось изменить пункт.')}};
 const createNote=async(e:FormEvent)=>{e.preventDefault();if(!newNote.title||!newNote.body)return;try{await post('/notes',newNote);setNewNote({title:'',body:''});await reload()}catch(err){setError(err instanceof Error?err.message:'Не удалось сохранить заметку.')}};
 const createIdea=async(e:FormEvent)=>{e.preventDefault();if(!newIdea.title)return;try{await post('/ideas',newIdea);setNewIdea({title:'',description:''});await reload()}catch(err){setError(err instanceof Error?err.message:'Не удалось сохранить идею.')}};
 const createFinance=async(e:FormEvent)=>{e.preventDefault();try{await post('/finances',newFinance);setNewFinance({...newFinance,amount:'',description:''});await reload()}catch(err){setError(err instanceof Error?err.message:'Не удалось сохранить операцию.')}};
 if(busy&&!me)return <div className="loading">Загружаем Family Hub…</div>;
 return <div className="app-shell"><header className="topbar"><div><div className="eyebrow">Семья</div><h1>{family?.name??'Family Hub'}</h1></div><div className="user-badge">{me?.first_name?.slice(0,1)??'?'}</div></header>{error&&<div className="error-banner">{error}<button onClick={()=>setError(null)}>×</button></div>}<main className="page">
  {section==='home'&&<HomeView events={todayEvents} reminders={todayReminders} lists={lists} onEvent={setSelectedEvent} onSection={setSection}/>} 
  {section==='calendar'&&<CalendarView events={events} reminders={reminders} onCreate={()=>{setEventForm({...emptyEvent(),responsible_member_id:family?.members[0]?.id??'',participant_member_ids:family?.members.slice(0,1).map(m=>m.id)??[]});setShowEvent(true)}} onEvent={setSelectedEvent} onReminder={createReminder}/>} 
  {section==='lists'&&<ListsView lists={lists} newItem={newItem} setNewItem={setNewItem} onAdd={addItem} onToggle={toggleItem}/>} 
  {section==='more'&&<MoreView family={family} setSection={setSection}/>} 
  {section==='notes'&&<NotesView notes={notes} form={newNote} setForm={setNewNote} onSubmit={createNote} onDelete={async id=>{try{await del(`/notes/${id}`);await reload()}catch(err){setError(err instanceof Error?err.message:'Не удалось удалить заметку.')}}}/>} 
  {section==='ideas'&&<IdeasView ideas={ideas} form={newIdea} setForm={setNewIdea} onSubmit={createIdea} onDelete={async id=>{try{await del(`/ideas/${id}`);await reload()}catch(err){setError(err instanceof Error?err.message:'Не удалось удалить идею.')}}}/>} 
  {section==='finance'&&<FinanceView allowed={family?.my_role==='ADMIN'} finance={finance} credits={credits} form={newFinance} setForm={setNewFinance} onSubmit={createFinance} onDelete={async id=>{try{await del(`/finances/${id}`);await reload()}catch(err){setError(err instanceof Error?err.message:'Не удалось удалить операцию.')}}} onReload={reload}/>} 
 </main><nav className="bottom-nav"><NavItem a={section==='home'} l="Главная" i="⌂" c={()=>setSection('home')}/><NavItem a={section==='calendar'} l="Календарь" i="□" c={()=>setSection('calendar')}/><NavItem a={section==='lists'} l="Списки" i="☷" c={()=>setSection('lists')}/><NavItem a={section==='more'} l="Ещё" i="•••" c={()=>setSection('more')}/></nav>{showEvent&&<EventSheet form={eventForm} setForm={setEventForm} members={family?.members??[]} onClose={()=>setShowEvent(false)} onSubmit={createEvent} busy={busy}/>} {selectedEvent&&<EventDetails event={selectedEvent} onClose={()=>setSelectedEvent(null)}/>}</div>
}

function HomeView(p:{events:EventItem[];reminders:Reminder[];lists:FamilyList[];onEvent:(e:EventItem)=>void;onSection:(s:Section)=>void}){const items=p.lists.flatMap(l=>l.items.filter(i=>!i.is_completed)).slice(0,5);return <div className="stack"><SectionTitle title="Сегодня" subtitle={new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}/><div className="grid-2"><Card title="События">{p.events.map(e=><EventRow key={e.id} event={e} onClick={()=>p.onEvent(e)}/>)}{p.reminders.map(r=><ReminderRow key={r.id} reminder={r}/>)}{!p.events.length&&!p.reminders.length&&<p className="muted">Сегодня ничего не запланировано.</p>}</Card><Card title="Список"><strong>{p.lists[0]?.name??'Продукты'}</strong>{items.map(i=><button className="list-row interactive" key={i.id} onClick={()=>p.onSection('lists')}><span className="checkbox"/>{i.title}</button>)}<button className="button primary full" onClick={()=>p.onSection('lists')}>Открыть список</button></Card></div><Card title="Ближайшее">{p.events.slice(0,3).map(e=><EventRow key={e.id} event={e} onClick={()=>p.onEvent(e)}/>)}</Card><Card title="Разделы"><div className="quick-grid"><button onClick={()=>p.onSection('notes')}>📝 Заметки</button><button onClick={()=>p.onSection('ideas')}>💡 Идеи</button><button onClick={()=>p.onSection('finance')}>₽ Финансы</button><button onClick={()=>p.onSection('more')}>👨‍👩‍👧 Семья</button></div></Card></div>}
function CalendarView(p:{events:EventItem[];reminders:Reminder[];onCreate:()=>void;onEvent:(e:EventItem)=>void;onReminder:()=>void}){return <div className="stack"><SectionTitle title="Календарь" subtitle="События и напоминания" action={<button className="icon-button" onClick={p.onCreate}>＋</button>}/><Card title="События">{p.events.length?p.events.map(e=><EventRow key={e.id} event={e} detailed onClick={()=>p.onEvent(e)}/>):<p className="muted">Событий пока нет.</p>}</Card><Card title="Напоминания">{p.reminders.map(r=><ReminderRow key={r.id} reminder={r} detailed/>)}<button className="button primary full" onClick={p.onReminder}>＋ Создать напоминание</button></Card></div>}
function ListsView(p:{lists:FamilyList[];newItem:string;setNewItem:(v:string)=>void;onAdd:()=>void;onToggle:(i:ListItem)=>void}){return <div className="stack"><SectionTitle title="Списки" subtitle="Общие семейные списки"/>{p.lists.map(l=><Card key={l.id} title={l.name}>{l.items.map(i=><button className="list-row interactive" key={i.id} onClick={()=>p.onToggle(i)}><span className={i.is_completed?'checkbox checked':'checkbox'}>{i.is_completed?'✓':''}</span><span className={i.is_completed?'done':''}>{i.title}</span></button>)}<div className="inline-form"><input value={p.newItem} onChange={e=>p.setNewItem(e.target.value)} placeholder="Добавить пункт" onKeyDown={e=>e.key==='Enter'&&p.onAdd()}/><button className="button primary" onClick={p.onAdd}>Добавить</button></div></Card>)}</div>}
function MoreView(p:{family:Family|null;setSection:(s:Section)=>void}){return <div className="stack"><SectionTitle title="Ещё" subtitle="Инструменты и семья"/><Card title="Инструменты"><div className="menu-grid"><button onClick={()=>p.setSection('notes')}>📝<strong>Мои заметки</strong><small>Личные записи</small></button><button onClick={()=>p.setSection('ideas')}>💡<strong>Идеи</strong><small>Семейные идеи</small></button><button onClick={()=>p.setSection('finance')}>₽<strong>Финансы</strong><small>Только для админов</small></button></div></Card><Card title="Семья"><div className="member-list">{p.family?.members.map(m=><div className="member-row" key={m.id}><span>{m.user.first_name}</span><span className="role-badge">{m.role==='ADMIN'?'Админ':'Пользователь'}</span></div>)}</div></Card></div>}
function NotesView(p:{notes:Note[];form:{title:string;body:string};setForm:(x:{title:string;body:string})=>void;onSubmit:(e:FormEvent)=>void;onDelete:(id:string)=>void}){return <div className="stack"><SectionTitle title="Мои заметки" subtitle="Личные записи"/><Card title="Новая заметка"><form onSubmit={p.onSubmit} className="form-stack"><input value={p.form.title} onChange={e=>p.setForm({...p.form,title:e.target.value})} placeholder="Заголовок"/><textarea value={p.form.body} onChange={e=>p.setForm({...p.form,body:e.target.value})} placeholder="Текст заметки"/><button className="button primary">Сохранить</button></form></Card>{p.notes.map(n=><Card key={n.id} title={n.title}><p className="note-body">{n.body}</p><button className="button secondary" onClick={()=>p.onDelete(n.id)}>Удалить</button></Card>)}</div>}
function IdeasView(p:{ideas:Idea[];form:{title:string;description:string};setForm:(x:{title:string;description:string})=>void;onSubmit:(e:FormEvent)=>void;onDelete:(id:string)=>void}){return <div className="stack"><SectionTitle title="Идеи" subtitle="Общие семейные идеи"/><Card title="Добавить идею"><form onSubmit={p.onSubmit} className="form-stack"><input value={p.form.title} onChange={e=>p.setForm({...p.form,title:e.target.value})} placeholder="Например, съездить на море"/><textarea value={p.form.description} onChange={e=>p.setForm({...p.form,description:e.target.value})} placeholder="Описание"/><button className="button primary">Сохранить</button></form></Card>{p.ideas.map(i=><Card key={i.id} title={i.title}><p className="muted">{i.description}</p><span className="role-badge">{i.status}</span><button className="button secondary full" onClick={()=>p.onDelete(i.id)}>Удалить</button></Card>)}</div>}

function FinanceView(p:{allowed:boolean;finance:{data:FinanceTransaction[];summary:FinanceSummary}|null;credits:Credit[];form:FinanceForm;setForm:(x:FinanceForm)=>void;onSubmit:(e:FormEvent)=>void;onDelete:(id:string)=>void;onReload:()=>Promise<void>}){
 const [tab,setTab]=useState<FinanceTab>('overview'); const [monthlyIncome,setMonthlyIncome]=useState(0); const [fixed,setFixed]=useState(0); const [future,setFuture]=useState(0); const [flexible,setFlexible]=useState(0); const [savingsRate,setSavingsRate]=useState(10); const [emergencyMonthly,setEmergencyMonthly]=useState(100000); const [emergencyMonths,setEmergencyMonths]=useState(3); const [emergencySaved,setEmergencySaved]=useState(24000); const [emergencyMonthlySave,setEmergencyMonthlySave]=useState(10000); const [emergencyTargetMonths,setEmergencyTargetMonths]=useState(12); const [largeExpenses,setLargeExpenses]=useState<LargeExpense[]>([]); const [annual,setAnnual]=useState<number[][]>(ANNUAL_CATEGORIES.map(()=>Array(12).fill(0)));
 if(!p.allowed)return <div className="stack"><SectionTitle title="Финансы" subtitle="Доступ ограничен"/><Card title="Только для администраторов"><p className="muted">Раздел доступен только администратору семьи.</p></Card></div>;
 const expenses=p.finance?.data.filter(x=>x.type==='EXPENSE')??[]; const actualFlexible=expenses.filter(x=>x.budget_type==='FLEXIBLE'); const currentMonth=new Date().getMonth(); const currentYear=new Date().getFullYear(); const actualFlexibleMonth=actualFlexible.filter(x=>{const d=new Date(`${x.occurred_on}T00:00:00`);return d.getFullYear()===currentYear&&d.getMonth()===currentMonth}).reduce((s,x)=>s+num(x.amount),0); const daysInMonth=new Date(currentYear,currentMonth+1,0).getDate(); const dayOfMonth=new Date().getDate(); const savingsMonthly=monthlyIncome*(savingsRate/100); const available=monthlyIncome-fixed-future-savingsMonthly; const dailyLimit=available>0?available/daysInMonth:0; const safeToSpend=Math.max(0,dailyLimit*dayOfMonth-actualFlexibleMonth); const singleImportant=flexible/4.3; const maneuver=monthlyIncome-(fixed+future+flexible); const emergencyTarget=emergencyMonthly*emergencyMonths; const emergencyRemaining=Math.max(0,emergencyTarget-emergencySaved); const emergencyMonthsToGoal=emergencyMonthlySave>0?emergencyRemaining/emergencyMonthlySave:Infinity; const emergencyRequiredPerMonth=emergencyTargetMonths>0?emergencyRemaining/emergencyTargetMonths:0; const largeTotals=largeExpenses.reduce((a,x)=>{const m=x.cost/Math.max(1,x.months);a.total+=m;if(x.kind==='NECESSITY')a.necessity+=m;else a.want+=m;return a},{total:0,necessity:0,want:0}); const annualRows=ANNUAL_CATEGORIES.map(([name],i)=>({name,total:annual[i].reduce((a,b)=>a+b,0)}));
 return <div className="stack"><SectionTitle title="Финансы" subtitle="Доходы, бюджет, накопления и обязательства"/><div className="finance-tabs">{([['overview','Обзор'],['budget','Единственное число'],['annual','Год'],['savings','Подушка'],['large','Крупные расходы'],['debt','Кредиты']] as [FinanceTab,string][]).map(([v,l])=><button key={v} className={tab===v?'finance-tab active':'finance-tab'} onClick={()=>setTab(v)}>{l}</button>)}</div>
 {tab==='overview'&&<><div className="grid-3"><Metric title="Доходы" value={p.finance?.summary.income??0}/><Metric title="Расходы" value={p.finance?.summary.expense??0}/><Metric title="Баланс" value={p.finance?.summary.balance??0}/></div><Card title="Добавить операцию"><form onSubmit={p.onSubmit} className="form-grid"><select value={p.form.type} onChange={e=>p.setForm({...p.form,type:e.target.value as FinanceForm['type']})}><option value="EXPENSE">Расход</option><option value="INCOME">Доход</option></select><input value={p.form.amount} onChange={e=>p.setForm({...p.form,amount:e.target.value})} type="number" min="0.01" step="0.01" placeholder="Сумма" required/><input value={p.form.category} onChange={e=>p.setForm({...p.form,category:e.target.value})} placeholder="Категория" required/><input value={p.form.occurred_on} onChange={e=>p.setForm({...p.form,occurred_on:e.target.value})} type="date" required/><select value={p.form.budget_type} onChange={e=>p.setForm({...p.form,budget_type:e.target.value as FinanceForm['budget_type']})}><option value="FLEXIBLE">Гибкие</option><option value="FIXED">Фиксированные</option><option value="FUTURE">Моё будущее</option></select><input className="wide" value={p.form.description} onChange={e=>p.setForm({...p.form,description:e.target.value})} placeholder="Описание"/><button className="button primary wide">Сохранить</button></form></Card><Card title="Последние операции">{p.finance?.data.length?p.finance.data.map(t=><div className="finance-row" key={t.id}><div><strong>{t.category}</strong><small>{t.occurred_on} · {t.budget_type==='FIXED'?'Фиксированные':t.budget_type==='FUTURE'?'Моё будущее':'Гибкие'}</small></div><b className={t.type==='INCOME'?'income':'expense'}>{t.type==='INCOME'?'+':'−'} {rub(num(t.amount))}</b><button onClick={()=>p.onDelete(t.id)}>×</button></div>):<p className="muted">Операций пока нет.</p>}</Card></>}
 {tab==='budget'&&<BudgetTool monthlyIncome={monthlyIncome} setMonthlyIncome={setMonthlyIncome} fixed={fixed} setFixed={setFixed} future={future} setFuture={setFuture} flexible={flexible} setFlexible={setFlexible} savingsRate={savingsRate} setSavingsRate={setSavingsRate} singleImportant={singleImportant} maneuver={maneuver} savingsMonthly={savingsMonthly} dailyLimit={dailyLimit} safeToSpend={safeToSpend} actualFlexibleMonth={actualFlexibleMonth} daysInMonth={daysInMonth} dayOfMonth={dayOfMonth}/>} 
 {tab==='annual'&&<AnnualBudget annual={annual} setAnnual={setAnnual} rows={annualRows}/>} {tab==='savings'&&<EmergencyFund monthly={emergencyMonthly} setMonthly={setEmergencyMonthly} months={emergencyMonths} setMonths={setEmergencyMonths} saved={emergencySaved} setSaved={setEmergencySaved} monthlySave={emergencyMonthlySave} setMonthlySave={setEmergencyMonthlySave} targetMonths={emergencyTargetMonths} setTargetMonths={setEmergencyTargetMonths} target={emergencyTarget} remaining={emergencyRemaining} monthsToGoal={emergencyMonthsToGoal} requiredPerMonth={emergencyRequiredPerMonth}/>} {tab==='large'&&<LargeExpensePlanner rows={largeExpenses} setRows={setLargeExpenses} totals={largeTotals}/>} {tab==='debt'&&<CreditsPlanner credits={p.credits} onReload={p.onReload}/>} </div>
}

function validatePaymentSchedule(items:PaymentScheduleInputItem[],term:number):string|null{
 const sorted=[...items].sort((a,b)=>a.from_month-b.from_month);
 if(!sorted.length)return 'Добавьте хотя бы один период договорного графика.';
 let expected=1;
 for(let i=0;i<sorted.length;i++){
  const row=sorted[i];
  if(row.from_month!==expected)return `В договорном графике есть пропуск или перекрытие перед периодом ${row.from_month}. Ожидался месяц ${expected}.`;
  if(row.to_month<row.from_month)return `Период ${row.from_month}–${row.to_month} задан неверно.`;
  if(row.to_month>term)return `Период заканчивается на ${row.to_month}-м месяце, а срок кредита — ${term} мес.`;
  if(num(row.amount)<=0)return `Укажите платёж для периода ${row.from_month}–${row.to_month}.`;
  expected=row.to_month+1;
 }
 if(expected!==term+1)return `Договорный график должен быть заполнен до ${term}-го месяца. Сейчас заканчивается на ${expected-1}-м.`;
 return null;
}

function apiSchedule(items:PaymentScheduleInputItem[]):PaymentScheduleItem[]{
 return [...items].sort((a,b)=>a.from_month-b.from_month).map(x=>({from_month:Math.round(x.from_month),to_month:Math.round(x.to_month),amount:num(x.amount)}));
}

function PaymentScheduleEditor({items,setItems,term}:{items:PaymentScheduleInputItem[];setItems:(items:PaymentScheduleInputItem[])=>void;term:number}){
 const update=(index:number,key:keyof PaymentScheduleInputItem,value:string)=>{const next=[...items];next[index]={...next[index],[key]:key==='amount'?value:Math.max(1,Math.round(num(value)))};setItems(next)};
 const add=()=>{const last=items[items.length-1];const from=Math.min(term,last?last.to_month+1:1);setItems([...items,{from_month:from,to_month:term,amount:''}]);};
 const remove=(index:number)=>{if(items.length===1)return;setItems(items.filter((_,i)=>i!==index));};
 const err=validatePaymentSchedule(items,term);
 return <Card title="Договорный график платежей">
   <p className="hint">Заполните реальные суммы из договора. Можно задать разные платежи по периодам — это важно, если банк меняет размер платежа в течение срока кредита.</p>
   <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>С месяца</th><th>По месяц</th><th>Платёж, ₽</th><th></th></tr></thead><tbody>{items.map((row,i)=><tr key={`${row.from_month}-${i}`}><td><input className="mini-input" type="number" min="1" max={term} value={row.from_month} onChange={e=>update(i,'from_month',e.target.value)}/></td><td><input className="mini-input" type="number" min="1" max={term} value={row.to_month} onChange={e=>update(i,'to_month',e.target.value)}/></td><td><input className="mini-input" type="number" min="0.01" step="0.01" value={row.amount} onChange={e=>update(i,'amount',e.target.value)} placeholder="69 706,07"/></td><td><button className="tiny-action" type="button" onClick={()=>remove(i)} disabled={items.length===1}>×</button></td></tr>)}</tbody></table></div>
   {err&&<div className="warning-banner">{err}</div>}
   <button className="button secondary" type="button" onClick={add} disabled={items.length>=term}>＋ Добавить период</button>
 </Card>;
}

function CreditsPlanner({credits,onReload}:{credits:Credit[];onReload:()=>Promise<void>}){
 const [showAdd,setShowAdd]=useState(credits.length===0); const [form,setForm]=useState<CreditForm>(emptyCredit()); const [saving,setSaving]=useState(false); const [localError,setLocalError]=useState<string|null>(null);
 const term=Math.max(1,Math.round(num(form.term_months)));
 const submit=async(e:FormEvent)=>{e.preventDefault();setLocalError(null);const scheduleError=validatePaymentSchedule(form.payment_schedule,term);if(scheduleError){setLocalError(scheduleError);return;}setSaving(true);try{await post('/credits',{...form,name:form.name||'Кредит',principal:num(form.principal),annual_rate:num(form.annual_rate),standard_payment:num(form.standard_payment),term_months:term,start_date:form.start_date,first_payment_date:form.first_payment_date,recalculation_mode:form.recalculation_mode,payment_schedule:apiSchedule(form.payment_schedule)});setForm(emptyCredit());setShowAdd(false);await onReload()}catch(err){setLocalError(err instanceof Error?err.message:'Не удалось создать кредит.')}finally{setSaving(false)}};
 return <div className="stack">{localError&&<div className="error-banner">{localError}</div>}<Card title="Кредиты"><div className="credit-header"><div><strong>{credits.length?'Мои кредиты':'Добавьте первый кредит'}</strong><p className="muted">Сначала задайте параметры договора. Затем добавляйте фактические досрочные платежи — даже за прошлые даты.</p></div><button className="button primary" onClick={()=>setShowAdd(v=>!v)}>{showAdd?'Отмена':'＋ Добавить кредит'}</button></div>{showAdd&&<form onSubmit={submit} className="credit-form"><div className="form-grid"><label>Название<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ипотека"/></label><label>Сумма кредита<input type="number" min="0.01" step="0.01" value={form.principal} onChange={e=>setForm({...form,principal:e.target.value})} required/></label><label>Годовая ставка, %<input type="number" min="0" step="0.01" value={form.annual_rate} onChange={e=>setForm({...form,annual_rate:e.target.value})} required/></label><label>Ежемесячный платёж<input type="number" min="0.01" step="0.01" value={form.standard_payment} onChange={e=>setForm({...form,standard_payment:e.target.value})} required/></label><label>Срок кредита, месяцев<input type="number" min="1" max="600" step="1" value={form.term_months} onChange={e=>{const nextTerm=Math.max(1,Math.round(num(e.target.value)));const current=form.payment_schedule;const next=current.map((x,i)=>i===0&&current.length===1?{...x,to_month:nextTerm}:x);setForm({...form,term_months:e.target.value,payment_schedule:next})}} required/></label><label>Дата старта кредита<input type="date" value={form.start_date} onChange={e=>setForm({...form,start_date:e.target.value})} required/></label><label>Дата первого ежемесячного платежа<input type="date" min={form.start_date} value={form.first_payment_date} onChange={e=>setForm({...form,first_payment_date:e.target.value})} required/></label><label>Пересчёт после досрочного<select value={form.recalculation_mode} onChange={e=>setForm({...form,recalculation_mode:e.target.value as CreditForm['recalculation_mode']})}><option value="TERM">Сокращать срок</option><option value="PAYMENT">Уменьшать платёж</option></select></label></div><PaymentScheduleEditor items={form.payment_schedule} setItems={x=>setForm({...form,payment_schedule:x})} term={term}/><div className="button-row"><button className="button secondary" type="button" onClick={()=>setShowAdd(false)}>Отмена</button><button className="button primary" disabled={saving}>{saving?'Сохраняем…':'Добавить кредит'}</button></div></form>}</Card>{credits.map(c=><CreditCard key={c.id} credit={c} onReload={onReload}/>)}</div>
}

function CreditCard({credit,onReload}:{credit:Credit;onReload:()=>Promise<void>}){
 const principal=num(credit.principal); const rate=num(credit.annual_rate); const originalPayment=num(credit.standard_payment); const originalMonths=Math.max(1,Math.round(num(credit.term_months)));
 const savedSchedule=(credit.payment_schedule??[]).map(x=>({from_month:Number(x.from_month),to_month:Number(x.to_month),amount:String(x.amount)}));
 const initialSchedule=(isCompletePaymentSchedule(savedSchedule,originalMonths)?savedSchedule:contractScheduleFallback(credit));
 const [showMore,setShowMore]=useState(false); const [prepayAmount,setPrepayAmount]=useState(''); const [prepayDate,setPrepayDate]=useState(todayString()); const [prepayComment,setPrepayComment]=useState(''); const [mode,setMode]=useState(credit.recalculation_mode); const [edit,setEdit]=useState(false); const [editPayment,setEditPayment]=useState(String(originalPayment)); const [editStartDate,setEditStartDate]=useState(credit.start_date); const [editFirstPaymentDate,setEditFirstPaymentDate]=useState(credit.first_payment_date); const [editTermMonths,setEditTermMonths]=useState(String(credit.term_months)); const [editSchedule,setEditSchedule]=useState<PaymentScheduleInputItem[]>(initialSchedule); const [busy,setBusy]=useState(false);
 const schedule=useCreditSchedule(credit,mode); const visibleRows=showMore?schedule.rows:schedule.rows.slice(0,12);
 const submitPrepay=async(e:FormEvent)=>{e.preventDefault();const amount=num(prepayAmount);const date=normalizeDateOnly(prepayDate);if(amount<=0||!date||date<credit.start_date||date>todayString()){alert('Укажите корректную сумму и дату досрочного платежа.');return;}setBusy(true);try{await post(`/credits/${credit.id}/prepayments`,{amount,paid_on:date,comment:prepayComment||null});setPrepayAmount('');setPrepayComment('');setPrepayDate(todayString());await onReload()}catch(err){alert(err instanceof Error?err.message:'Не удалось сохранить досрочный платёж.')}finally{setBusy(false)}};
 const saveEdit=async()=>{const editTerm=Math.max(1,Math.round(num(editTermMonths)));const scheduleError=validatePaymentSchedule(editSchedule,editTerm);if(scheduleError){alert(scheduleError);return;}setBusy(true);try{await patch(`/credits/${credit.id}`,{standard_payment:num(editPayment),term_months:editTerm,start_date:editStartDate,first_payment_date:editFirstPaymentDate,recalculation_mode:mode,payment_schedule:apiSchedule(editSchedule)});await onReload();setEdit(false)}catch(err){alert(err instanceof Error?err.message:'Не удалось обновить кредит.')}finally{setBusy(false)}};
 const remove=async()=>{if(!window.confirm('Удалить кредит и историю досрочных платежей?'))return;setBusy(true);try{await del(`/credits/${credit.id}`);await onReload()}catch(err){alert(err instanceof Error?err.message:'Не удалось удалить кредит.')}finally{setBusy(false)}};
 return <Card title={credit.name}><div className="credit-summary"><Metric title="Сумма кредита" value={principal}/><Metric title="Стандартный платёж" value={originalPayment}/><Metric title="Ставка" value={rate} unit="%"/><Metric title="Срок по договору" value={originalMonths} unit="мес."/></div>
 <div className="credit-actions"><button className="button secondary" onClick={()=>setEdit(v=>!v)}>{edit?'Отмена':'Настройки'}</button><button className="button secondary" onClick={remove}>Удалить</button></div>
 {edit&&<><div className="payment-editor"><div className="form-grid"><label>Стандартный платёж<input type="number" min="0.01" step="0.01" value={editPayment} onChange={e=>setEditPayment(e.target.value)}/></label><label>Срок, мес.<input type="number" min="1" max="600" step="1" value={editTermMonths} onChange={e=>setEditTermMonths(e.target.value)}/></label><label>Дата старта<input type="date" value={editStartDate} onChange={e=>setEditStartDate(e.target.value)}/></label><label>Дата первого платежа<input type="date" min={editStartDate} value={editFirstPaymentDate} onChange={e=>setEditFirstPaymentDate(e.target.value)}/></label><label>Пересчёт<select value={mode} onChange={e=>setMode(e.target.value as 'TERM'|'PAYMENT')}><option value="TERM">Сокращать срок</option><option value="PAYMENT">Уменьшать платёж</option></select></label></div><PaymentScheduleEditor items={editSchedule} setItems={setEditSchedule} term={Math.max(1,Math.round(num(editTermMonths)))} /><button className="button primary" onClick={saveEdit} disabled={busy}>Сохранить</button></div></>}
 <div className="formula-grid"><Metric title="Остаток на сегодня" value={schedule.currentBalance}/><Metric title="Начислено процентов на сегодня" value={schedule.accruedInterestAsOf}/><Metric title="Следующий платёж" value={schedule.nextPaymentAmount}/><div className="metric"><span>Дата следующего платежа</span><strong>{schedule.nextPaymentDate?dateRu(schedule.nextPaymentDate):'Кредит погашен'}</strong></div></div>
 <div className="schedule-meta"><span>Расчёт по состоянию на: <b>{dateRu(schedule.asOfDate)}</b></span><span>Прошлые обычные платежи: <b>считаются внесёнными по договорному графику</b></span><span>Погашено по графику: <b>{schedule.paidMonths} мес.</b></span><span>Исходная дата окончания: <b>{dateRu(schedule.originalEndDate)}</b></span><span>Прогнозная дата окончания: <b>{schedule.projectedEndDate?dateRu(schedule.projectedEndDate):dateRu(schedule.originalEndDate)}</b></span></div>
 <div className="prepayment-form"><div className="prepayment-heading"><div><strong>Досрочное погашение</strong><span className="muted">Историю можно заносить задним числом.</span></div></div><p className="hint">В день регулярного платежа досрочка уменьшает тело после обычного платежа. После даты платежа сначала списываются проценты за фактические дни, затем остаток уменьшает тело.</p><form onSubmit={submitPrepay} className="form-grid"><label>Сумма<input type="number" min="0.01" step="0.01" value={prepayAmount} onChange={e=>setPrepayAmount(e.target.value)} placeholder="1 000,52" required/></label><label>Дата внесения<input type="date" min={credit.start_date} max={todayString()} value={prepayDate} onChange={e=>setPrepayDate(e.target.value)} required/></label><label className="wide">Комментарий<input value={prepayComment} onChange={e=>setPrepayComment(e.target.value)} placeholder="Например, премия"/></label><button className="button primary wide" disabled={busy}>Сохранить досрочный платёж</button></form></div>
 {credit.prepayments.length>0&&<Card title="История досрочных платежей"><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Дата</th><th>Сумма</th><th>Комментарий</th><th></th></tr></thead><tbody>{credit.prepayments.map(pp=><PrepaymentRow key={pp.id} pp={pp} onReload={onReload}/>)}</tbody></table></div></Card>}
 <div className="formula-grid"><Metric title="Проценты по полному прогнозу" value={schedule.totalInterest}/><Metric title="Строк графика" value={schedule.rows.length} unit="стр."/></div>
 <div className="table-scroll"><table className="finance-table"><thead><tr><th>№</th><th>Дата платежа</th><th>Договорный платёж</th><th>Проценты</th><th>Тело</th><th>Досрочно</th><th>Из досрочки %</th><th>Всего внесено</th><th>Остаток</th><th>Статус</th></tr></thead><tbody>{visibleRows.map(r=><tr key={r.month} className={r.prepayment>0?'highlight-row':''}><td>{r.month}</td><td>{dateRu(r.dueDate)}{r.prepaymentDates?.filter(d=>d!==r.dueDate).map(d=><small className="table-note" key={d}>досрочка {dateRu(d)}</small>)}</td><td>{rub(r.payment)}</td><td>{rub(r.interest)}</td><td>{rub(r.principal)}</td><td>{r.prepayment?rub(r.prepayment):'—'}</td><td>{r.prepaymentInterest?rub(r.prepaymentInterest):'—'}</td><td>{rub(r.totalPaid)}</td><td>{rub(r.balance)}</td><td>{r.newEndDate?`Срок: ${dateRu(r.newEndDate)}`:r.newPayment?`Платёж: ${rub(r.newPayment)}`:r.status==='PAID'?'Проведён':'Будущий'}</td></tr>)}</tbody></table></div>
 {schedule.rows.length>12&&<button className="button secondary full" onClick={()=>setShowMore(v=>!v)}>{showMore?'Свернуть':'Показать ещё'}</button>}
 </Card>
}
function PrepaymentRow({pp,onReload}:{pp:CreditPrepayment;onReload:()=>Promise<void>}){const [busy,setBusy]=useState(false);const remove=async()=>{if(!confirm('Удалить досрочный платёж?'))return;setBusy(true);try{await del(`/credit-prepayments/${pp.id}`);await onReload()}catch(err){alert(err instanceof Error?err.message:'Не удалось удалить платёж.')}finally{setBusy(false)}};return <tr><td>{dateRu(pp.paid_on)}</td><td>{rub(num(pp.amount))}</td><td>{pp.comment||'—'}</td><td><button onClick={remove} disabled={busy}>×</button></td></tr>}

function normalizeDateOnly(value:string):string{
  const s=String(value ?? '').trim();
  if(!s) return '';
  const m=s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function dateRu(value:string):string{
  const dateOnly=normalizeDateOnly(value);
  if(!dateOnly) return '—';
  const d=new Date(`${dateOnly}T00:00:00`);
  if(Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'});
}

function money(v:number):string{
  return v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function Metric(p:{title:string;value:number;unit?:string}){
  return <div className="metric"><span>{p.title}</span><strong>{money(p.value)}{p.unit ? ` ${p.unit}` : ' ₽'}</strong></div>;
}

function isCompletePaymentSchedule(items:PaymentScheduleInputItem[],term:number):boolean{
 const sorted=[...items].sort((a,b)=>a.from_month-b.from_month);
 if(!sorted.length)return false;
 let expected=1;
 for(const row of sorted){
   if(row.from_month!==expected||row.to_month<row.from_month||row.to_month>term||num(row.amount)<=0)return false;
   expected=row.to_month+1;
 }
 return expected===term+1;
}

function contractScheduleFallback(credit:Credit):PaymentScheduleInputItem[]{
 const principal=num(credit.principal);
 const rate=num(credit.annual_rate);
 const payment=num(credit.standard_payment);
 const term=Math.max(1,Math.round(num(credit.term_months)));
 const first=normalizeDateOnly(credit.first_payment_date);
 const isKnownMortgage=principal===3835200&&rate===21.4&&payment===69706.07&&term===360&&first==='2026-06-04';
 if(isKnownMortgage){
   return [
     {from_month:1,to_month:120,amount:'69706.07'},
     {from_month:121,to_month:240,amount:'60202.24'},
     {from_month:241,to_month:359,amount:'57734.02'},
     {from_month:360,to_month:360,amount:'70829.31'},
   ];
 }
 return [{from_month:1,to_month:term,amount:String(payment)}];
}

function paymentForMonth(items:PaymentScheduleItem[],month:number,fallback:number):number{
 const sorted=[...items].sort((a,b)=>a.from_month-b.from_month);
 const row=sorted.find(x=>month>=x.from_month&&month<=x.to_month);
 return row?row.amount:fallback;
}

function solveFixedPayment(balance:number,annualRate:number,anchor:string,dueDates:string[]):number{
 if(balance<=0.01||!dueDates.length)return 0;
 const simulate=(payment:number)=>{
   let b=balance;
   let prev=anchor;
   for(const due of dueDates){
     const interest=dailyAccruedInterest(b,annualRate,prev,due);
     const principalPart=Math.min(b,Math.max(0,payment-interest));
     b=Math.max(0,b-principalPart);
     prev=due;
     if(b<=0.005)break;
   }
   return b;
 };
 const rate=annualRate/100;
 if(rate===0)return balance/dueDates.length;
 let lo=0;
 let hi=Math.max(balance*(1+rate),balance/dueDates.length+balance*rate);
 while(simulate(hi)>0.005&&hi<balance*10)hi*=1.5;
 for(let i=0;i<80;i++){
   const mid=(lo+hi)/2;
   if(simulate(mid)>0.005)lo=mid; else hi=mid;
 }
 return hi;
}

function useCreditSchedule(credit:Credit,mode:'TERM'|'PAYMENT'){
 return useMemo(()=>{
  const principal=num(credit.principal);
  const annualRate=num(credit.annual_rate);
  const basePayment=num(credit.standard_payment);
  const originalTerm=Math.max(1,Math.round(num(credit.term_months)));
  const asOfDate=todayString();
  const firstPaymentDate=normalizeDateOnly(credit.first_payment_date);
  const startDate=normalizeDateOnly(credit.start_date);
  const savedSchedule=(credit.payment_schedule??[]).map(x=>({from_month:Number(x.from_month),to_month:Number(x.to_month),amount:String(x.amount)}));
  const scheduleSource=isCompletePaymentSchedule(savedSchedule,originalTerm)?savedSchedule:contractScheduleFallback(credit);
  const scheduleItems=scheduleSource
    .map(x=>({from_month:Number(x.from_month),to_month:Number(x.to_month),amount:num(x.amount)}))
    .filter(x=>x.to_month>=x.from_month&&x.amount>0)
    .sort((a,b)=>a.from_month-b.from_month);
  const historicalPrepayments=[...credit.prepayments]
    .map(pp=>({id:pp.id,amount:num(pp.amount),paid_on:normalizeDateOnly(pp.paid_on),comment:pp.comment}))
    .filter(pp=>pp.amount>0&&pp.paid_on>=startDate&&pp.paid_on<=asOfDate)
    .sort((a,b)=>a.paid_on.localeCompare(b.paid_on));

  let balance=principal;
  let totalInterest=0;
  let month=0;
  let paidMonths=0;
  let currentBalance=principal;
  let accruedInterestAsOf=0;
  let nextPaymentDate:string|undefined;
  let nextPaymentAmount=0;
  let currentCaptured=false;
  let interestAnchor=startDate;
  let futurePaymentOverride:number|undefined;
  const rows:ScheduleRow[]=[];
  const originalEndDate=addMonthsFromDate(firstPaymentDate,originalTerm-1);
  const contractOriginalPayments=Array.from({length:originalTerm},(_,i)=>paymentForMonth(scheduleItems,i+1,basePayment));
  const contractualPayment=contractOriginalPayments[0]??basePayment;

  while(balance>0.01&&month<originalTerm+1200){
    month++;
    const dueDate=addMonthsFromDate(firstPaymentDate,month-1);
    const nextDueDate=addMonthsFromDate(firstPaymentDate,month);
    const isHistorical=dueDate<=asOfDate;

    if(!isHistorical&&!currentCaptured){
      currentBalance=balance;
      nextPaymentDate=dueDate;
      const scheduled=futurePaymentOverride??paymentForMonth(scheduleItems,month,basePayment);
      nextPaymentAmount=roundMoney(Math.min(scheduled,roundMoney(balance+dailyAccruedInterest(balance,annualRate,interestAnchor,dueDate))));
      accruedInterestAsOf=asOfDate>interestAnchor?roundMoney(dailyAccruedInterest(balance,annualRate,interestAnchor,asOfDate)):0;
      currentCaptured=true;
    }

    const regularInterest=roundMoney(dailyAccruedInterest(balance,annualRate,interestAnchor,dueDate));
    const scheduledPayment=roundMoney(futurePaymentOverride??paymentForMonth(scheduleItems,month,basePayment));
    const regularPayment=roundMoney(Math.min(scheduledPayment,roundMoney(balance+regularInterest)));
    const regularPrincipal=roundMoney(Math.min(balance,Math.max(0,regularPayment-regularInterest)));
    balance=roundMoney(Math.max(0,balance-regularPrincipal));
    totalInterest+=regularInterest;

    let prepayment=0;
    let prepaymentInterest=0;
    let prepaymentPrincipal=0;
    const prepaymentDates:string[]=[];
    let lastPrepaymentDate:string|undefined;

    if(isHistorical){
      const periodPrepayments=historicalPrepayments.filter(pp=>pp.paid_on>=dueDate&&pp.paid_on<nextDueDate);
      for(const pp of periodPrepayments){
        if(balance<=0.01) break;
        const accrued=pp.paid_on===dueDate?0:roundMoney(dailyAccruedInterest(balance,annualRate,dueDate,pp.paid_on));
        const interestPart=roundMoney(Math.min(pp.amount,Math.max(0,accrued)));
        const principalPart=roundMoney(Math.min(balance,Math.max(0,roundMoney(pp.amount-interestPart))));
        prepayment=roundMoney(prepayment+pp.amount);
        prepaymentInterest=roundMoney(prepaymentInterest+interestPart);
        prepaymentPrincipal=roundMoney(prepaymentPrincipal+principalPart);
        prepaymentDates.push(pp.paid_on);
        totalInterest+=interestPart;
        balance=roundMoney(Math.max(0,balance-principalPart));
        lastPrepaymentDate=pp.paid_on;
      }
    }

    let newPayment:number|undefined;
    let paymentChangeDate:string|undefined;
    let newEndDate:string|undefined;

    if(prepayment>0.009&&balance>0.01&&isHistorical){
      if(mode==='PAYMENT'){
        const dueDates:string[]=[];
        for(let m=month+1;m<=originalTerm;m++)dueDates.push(addMonthsFromDate(firstPaymentDate,m-1));
        const anchor=lastPrepaymentDate&&lastPrepaymentDate!==dueDate?lastPrepaymentDate:dueDate;
        newPayment=solveFixedPayment(balance,annualRate,anchor,dueDates);
        futurePaymentOverride=newPayment;
        paymentChangeDate=nextDueDate;
      }else{
        let simulatedBalance=balance;
        let simulatedAnchor=lastPrepaymentDate&&lastPrepaymentDate!==dueDate?lastPrepaymentDate:dueDate;
        let payoff:string|undefined;
        for(let m=month+1;m<=originalTerm;m++){
          const futureDue=addMonthsFromDate(firstPaymentDate,m-1);
          const interest=roundMoney(dailyAccruedInterest(simulatedBalance,annualRate,simulatedAnchor,futureDue));
          const scheduled=roundMoney(paymentForMonth(scheduleItems,m,basePayment));
          const principalPart=roundMoney(Math.min(simulatedBalance,Math.max(0,scheduled-interest)));
          simulatedBalance=roundMoney(Math.max(0,simulatedBalance-principalPart));
          if(simulatedBalance<=0.005){payoff=futureDue;break;}
          simulatedAnchor=futureDue;
        }
        if(payoff)newEndDate=payoff;
      }
    }

    if(lastPrepaymentDate&&lastPrepaymentDate!==dueDate)interestAnchor=lastPrepaymentDate;
    else interestAnchor=dueDate;

    rows.push({month,dueDate,payment:regularPayment,interest:regularInterest,principal:regularPrincipal,prepayment,prepaymentInterest,prepaymentPrincipal,totalPaid:regularPayment+prepayment,balance,newPayment,paymentChangeDate,newEndDate,prepaymentDates:prepaymentDates.length?prepaymentDates:undefined,status:isHistorical?'PAID':'FUTURE'});

    if(isHistorical){
      paidMonths=Math.max(paidMonths,month);
      if(dueDate===asOfDate){
        currentBalance=balance;
        nextPaymentDate=nextDueDate;
        const scheduledNext=futurePaymentOverride??paymentForMonth(scheduleItems,month+1,basePayment);
        nextPaymentAmount=roundMoney(Math.min(scheduledNext,roundMoney(balance+dailyAccruedInterest(balance,annualRate,interestAnchor,nextDueDate))));
        accruedInterestAsOf=0;
        currentCaptured=true;
      }
    }

    if(balance<=0.01){currentBalance=0;break;}
  }

  if(!currentCaptured&&balance>0.01){
    currentBalance=balance;
    nextPaymentDate=addMonthsFromDate(firstPaymentDate,month);
    const scheduled=futurePaymentOverride??paymentForMonth(scheduleItems,month+1,basePayment);
    nextPaymentAmount=roundMoney(Math.min(scheduled,roundMoney(balance+dailyAccruedInterest(balance,annualRate,interestAnchor,nextPaymentDate))));
    accruedInterestAsOf=asOfDate>interestAnchor?roundMoney(dailyAccruedInterest(balance,annualRate,interestAnchor,asOfDate)):0;
  }

  const paidRows=rows.filter(r=>r.status==='PAID');
  const firstPayoffRow=rows.find(r=>r.balance<=0.005);
  const projectedEndDate=firstPayoffRow?.dueDate??originalEndDate;

  return {rows,currentBalance,totalInterest,endDate:projectedEndDate,originalEndDate,projectedEndDate,accruedInterestAsOf,nextPaymentDate,nextPaymentAmount,asOfDate,paidMonths,contractualPayment};
 },[credit,mode]);
}

function BudgetTool(p:{monthlyIncome:number;setMonthlyIncome:(v:number)=>void;fixed:number;setFixed:(v:number)=>void;future:number;setFuture:(v:number)=>void;flexible:number;setFlexible:(v:number)=>void;savingsRate:number;setSavingsRate:(v:number)=>void;singleImportant:number;maneuver:number;savingsMonthly:number;dailyLimit:number;safeToSpend:number;actualFlexibleMonth:number;daysInMonth:number;dayOfMonth:number}){return <div className="stack"><Card title="Метод «Единственное важное число»"><div className="form-grid"><label>Ежемесячный доход<input type="number" value={p.monthlyIncome||''} onChange={e=>p.setMonthlyIncome(num(e.target.value))}/></label><label>Фиксированные расходы<input type="number" value={p.fixed||''} onChange={e=>p.setFixed(num(e.target.value))}/></label><label>Расходы на будущее<input type="number" value={p.future||''} onChange={e=>p.setFuture(num(e.target.value))}/></label><label>Гибкие расходы<input type="number" value={p.flexible||''} onChange={e=>p.setFlexible(num(e.target.value))}/></label><label>Накопления, %<input type="number" min="0" max="100" value={p.savingsRate} onChange={e=>p.setSavingsRate(num(e.target.value))}/></label></div><div className="formula-grid"><Metric title="Пространство для манёвра" value={p.maneuver}/><Metric title="Накопления / месяц" value={p.savingsMonthly}/><Metric title="Единственное важное число / неделю" value={p.singleImportant}/></div><p className="hint">Формула: гибкие расходы ÷ 4,3 = недельный ориентир.</p></Card><Card title="Дневной лимит"><div className="formula-grid"><Metric title="Лимит на день" value={p.dailyLimit}/><Metric title="Фактически потрачено на гибкие" value={p.actualFlexibleMonth}/><Metric title="Безопасно потратить сегодня" value={p.safeToSpend}/></div><p className="hint">Лимит на день = (доход − фиксированные − будущее − накопления) ÷ дни месяца.</p><p className="muted">День {p.dayOfMonth} из {p.daysInMonth}.</p></Card></div>}
function AnnualBudget(p:{annual:number[][];setAnnual:(x:number[][])=>void;rows:{name:string;total:number}[]}){const [income,setIncome]=useState<number[]>(Array(12).fill(0));const monthExpenseTotals=RU_MONTHS.map((_,m)=>p.annual.reduce((s,row)=>s+row[m],0));const annualExpenseTotal=monthExpenseTotals.reduce((a,b)=>a+b,0);const monthNet=RU_MONTHS.map((_,m)=>income[m]-monthExpenseTotals[m]);const annualIncome=income.reduce((a,b)=>a+b,0);return <Card title="Планировщик годового бюджета"><div className="table-scroll"><table className="finance-table"><thead><tr><th>Категория</th>{RU_MONTHS.map(m=><th key={m}>{m}</th>)}<th>Итого</th></tr></thead><tbody><tr><td><b>Доход</b></td>{RU_MONTHS.map((_,m)=><td key={m}><input className="mini-input" type="number" value={income[m]||''} onChange={e=>{const x=[...income];x[m]=num(e.target.value);setIncome(x)}}/></td>)}<td><b>{rub(annualIncome)}</b></td></tr>{ANNUAL_CATEGORIES.map(([name],i)=><tr key={name}><td>{name}</td>{RU_MONTHS.map((_,m)=><td key={m}><input className="mini-input" type="number" value={p.annual[i][m]||''} onChange={e=>{const copy=p.annual.map(r=>[...r]);copy[i][m]=num(e.target.value);p.setAnnual(copy)}}/></td>)}<td><b>{rub(p.rows[i].total)}</b></td></tr>)}<tr><td><b>Итого расходов</b></td>{monthExpenseTotals.map((v,i)=><td key={i}><b>{rub(v)}</b></td>)}<td><b>{rub(annualExpenseTotal)}</b></td></tr><tr><td><b>Остаток</b></td>{monthNet.map((v,i)=><td key={i} className={v<0?'expense':''}><b>{rub(v)}</b></td>)}<td><b>{rub(annualIncome-annualExpenseTotal)}</b></td></tr></tbody></table></div></Card>}
function EmergencyFund(p:{monthly:number;setMonthly:(v:number)=>void;months:number;setMonths:(v:number)=>void;saved:number;setSaved:(v:number)=>void;monthlySave:number;setMonthlySave:(v:number)=>void;targetMonths:number;setTargetMonths:(v:number)=>void;target:number;remaining:number;monthsToGoal:number;requiredPerMonth:number}){return <Card title="Подушка безопасности"><div className="form-grid"><label>Ежемесячный бюджет<input type="number" value={p.monthly||''} onChange={e=>p.setMonthly(num(e.target.value))}/></label><label>Цель, месяцев<input type="number" min="3" max="6" value={p.months} onChange={e=>p.setMonths(Math.max(1,num(e.target.value)))}/></label><label>Уже накоплено<input type="number" value={p.saved||''} onChange={e=>p.setSaved(num(e.target.value))}/></label><label>Откладывать в месяц<input type="number" value={p.monthlySave||''} onChange={e=>p.setMonthlySave(num(e.target.value))}/></label><label>Срок достижения, месяцев<input type="number" min="1" value={p.targetMonths} onChange={e=>p.setTargetMonths(Math.max(1,num(e.target.value)))}/></label></div><div className="formula-grid"><Metric title="Размер подушки" value={p.target}/><Metric title="Осталось накопить" value={p.remaining}/><Metric title="Месяцев при текущем взносе" value={Number.isFinite(p.monthsToGoal)?p.monthsToGoal:0}/><Metric title="Нужно откладывать для цели" value={p.requiredPerMonth}/></div></Card>}
function LargeExpensePlanner(p:{rows:LargeExpense[];setRows:(x:LargeExpense[])=>void;totals:{total:number;necessity:number;want:number}}){return <div className="stack"><Card title="Планировщик крупных расходов"><div className="table-scroll"><table className="finance-table"><thead><tr><th>Расход</th><th>Стоимость</th><th>Период, мес.</th><th>Тип</th><th>Откладывать / мес.</th><th></th></tr></thead><tbody>{p.rows.map((r,i)=><tr key={i}><td><input value={r.name} onChange={e=>{const x=[...p.rows];x[i]={...r,name:e.target.value};p.setRows(x)}}/></td><td><input type="number" value={r.cost||''} onChange={e=>{const x=[...p.rows];x[i]={...r,cost:num(e.target.value)};p.setRows(x)}}/></td><td><input type="number" min="1" value={r.months} onChange={e=>{const x=[...p.rows];x[i]={...r,months:Math.max(1,num(e.target.value))};p.setRows(x)}}/></td><td><select value={r.kind} onChange={e=>{const x=[...p.rows];x[i]={...r,kind:e.target.value as LargeExpense['kind']};p.setRows(x)}}><option value="NECESSITY">Необходимость</option><option value="WANT">Пожелание</option></select></td><td>{rub(r.cost/Math.max(1,r.months))}</td><td><button onClick={()=>p.setRows(p.rows.filter((_,j)=>j!==i))}>×</button></td></tr>)}</tbody></table></div><button className="button secondary" onClick={()=>p.setRows([...p.rows,{name:'Новый расход',cost:0,months:12,kind:'WANT'}])}>＋ Добавить расход</button></Card><div className="grid-3"><Metric title="Всего откладывать" value={p.totals.total}/><Metric title="Необходимости" value={p.totals.necessity}/><Metric title="Пожелания" value={p.totals.want}/></div></div>}
function EventRow(p:{event:EventItem;detailed?:boolean;onClick:()=>void}){return <button className="event-row event-button" onClick={p.onClick}><div className="time">{new Date(p.event.start_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</div><div className="event-main"><div className="event-title">{p.event.title} {p.event.source==='APPLE_CALENDAR'&&<span className="source-badge">Apple</span>}</div><div className="event-meta">{p.event.location??'Без места'}{p.detailed?' · '+(p.event.source==='APPLE_CALENDAR'?'Только просмотр':'Family Hub'):''}</div></div><div className="event-arrow">›</div></button>}
function ReminderRow(p:{reminder:Reminder;detailed?:boolean}){return <div className="event-row"><div className="time">{new Date(p.reminder.scheduled_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</div><div className="event-main"><div className="event-title">🔔 {p.reminder.title}</div><div className="event-meta">{p.reminder.responsible_member?.user.first_name??'—'}{p.detailed?' · Уведомление в Telegram':''}</div></div></div>}
function EventSheet({form,setForm,members,onClose,onSubmit,busy}:{form:any;setForm:(x:any)=>void;members:Family['members'];onClose:()=>void;onSubmit:()=>void;busy:boolean}){return <div className="sheet-backdrop" onClick={onClose}><section className="sheet" onClick={e=>e.stopPropagation()}><div className="sheet-handle"/><h2>Новое событие</h2><input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Название"/><textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Описание"/><div className="form-grid"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/><input type="text" value={form.location} onChange={e=>setForm({...form,location:e.target.value})} placeholder="Место"/><input type="time" value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})}/><input type="time" value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></div><label>Ответственный<select value={form.responsible_member_id} onChange={e=>{const v=e.target.value;setForm({...form,responsible_member_id:v,participant_member_ids:Array.from(new Set([...form.participant_member_ids,v]))})}}>{members.map(m=><option key={m.id} value={m.id}>{m.user.first_name}</option>)}</select></label><label>Участники<div className="participant-list">{members.map(m=><label className="participant" key={m.id}><input type="checkbox" checked={form.participant_member_ids.includes(m.id)} onChange={e=>setForm({...form,participant_member_ids:e.target.checked?[...form.participant_member_ids,m.id]:form.participant_member_ids.filter((x:string)=>x!==m.id)})}/>{m.user.first_name}</label>)}</div></label><div className="button-row"><button className="button secondary" onClick={onClose}>Отмена</button><button className="button primary" disabled={busy||!form.title} onClick={onSubmit}>Создать</button></div></section></div>}
function EventDetails({event,onClose}:{event:EventItem;onClose:()=>void}){return <div className="sheet-backdrop" onClick={onClose}><section className="sheet" onClick={e=>e.stopPropagation()}><div className="sheet-handle"/><h2>{event.title}</h2><p className="muted">{new Date(event.start_at).toLocaleString('ru-RU')} — {new Date(event.end_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</p>{event.description&&<p>{event.description}</p>}{event.location&&<p>📍 {event.location}</p>}<p>Ответственный: {event.responsible_member?.user.first_name??'—'}</p><span className="source-badge">{event.source==='APPLE_CALENDAR'?'Apple Calendar':'Family Hub'}</span><button className="button secondary full" onClick={onClose}>Закрыть</button></section></div>}
function Card({title,children}:{title:string;children:ReactNode}){return <section className="card"><h3>{title}</h3>{children}</section>}
function SectionTitle({title,subtitle,action}:{title:string;subtitle?:string;action?:ReactNode}){return <div className="section-title"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>}
function NavItem(p:{a:boolean;l:string;i:string;c:()=>void}){return <button className={p.a?'nav-item active':'nav-item'} onClick={p.c}><span>{p.i}</span><small>{p.l}</small></button>}
