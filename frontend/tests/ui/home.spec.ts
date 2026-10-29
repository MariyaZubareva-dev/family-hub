import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function mockHome(page:Page,options:{empty?:boolean;finance?:boolean;calendar?:boolean;timezone?:string;time?:string}={}){
  await page.clock.install({time:new Date(options.time||'2026-10-21T09:00:00Z')})
  const members=[{id:'m1',user:{first_name:'Мария'}}]
  const events:any[]=options.empty?[]:[{id:'e1',title:'Обсудить семейные планы и покупки на следующую неделю',status:'SCHEDULED',start_at:'2026-10-21T07:00:00Z'},{id:'e2',title:'Завтрашняя встреча',status:'SCHEDULED',start_at:'2026-10-22T12:00:00Z'}]
  const reminders:any[]=options.empty?[]:[{id:'r1',can_complete:true,title:'Забрать заказ',status:'SCHEDULED',scheduled_at:'2026-10-21T14:00:00Z'},{id:'r2',title:'Отменённое напоминание',status:'CANCELLED',scheduled_at:'2026-10-21T12:00:00Z'}]
  const requests:{path:string;body:any;method:string;search:string}[]=[]
  const receipts:any[]=[],transactions:any[]=[]
  let failBudget=false
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1',''),method=req.method(),body=method==='POST'?req.postDataJSON():null
    requests.push({path,body,method,search:url.search})
    let data:any=[]
    if(path==='/me')data={family:{id:'f1',role:'ADMIN',visibility:{finance:options.finance!==false,calendar:options.calendar!==false,shopping:true}}}
    else if(path==='/family')data={timezone:options.timezone||'Europe/Moscow',members,current_member_id:'m1'}
    else if(path==='/reminders/r1'&&method==='PATCH'){Object.assign(reminders[0],req.postDataJSON());data=reminders[0]}
    else if(path==='/events'||path==='/reminders'){
      const rows=path==='/events'?events:reminders
      if(body)rows.push({id:'created'+rows.length,status:'SCHEDULED',...body})
      data=body?rows.at(-1):rows
    }else if(path==='/finance/analytics'){
      if(failBudget){await route.fulfill({status:503,json:{message:'Unavailable'}});return}
      const spent=options.empty?0:15500
      data={total_income:options.empty?0:50000,total_expense:spent+transactions.length*100,balance:options.empty?0:50000-spent-transactions.length*100,ranked:options.empty?[]:['Продукты','Кафе и рестораны','Транспорт','Дом','Здоровье','Длиннаякатегориябезпробелов','Подарки'].map((name,i)=>({id:'c'+i,name,amount:[6000,3000,2500,1500,1000,900,600][i]})),trend:[]}
    }else if(path==='/finance/categories')data=[{id:'c0',name:'Продукты',transaction_type:'EXPENSE'}]
    else if(path==='/finances')data=transactions
    else if(path==='/credits')data=options.empty?[]:[{id:'loan1',name:'Рассрочка на технику',first_payment_date:'2026-10-25',standard_payment:1000,term_months:12}]
    else if(path==='/finance/receipts'){
      if(body)receipts.push({id:'receipt1',can_edit:true,ocr_status:'COMPLETED',review_payload:{merchant:'Магазин',date:'2026-10-21',receipt_total:100,items:[{name:'Молоко',qty:1,price:100,category_id:'c0',category:'Продукты'}]}})
      data=body?receipts.at(-1):receipts
    }else if(path==='/finance/receipts/receipt1/confirm'){
      receipts[0].ocr_status='CONFIRMED';transactions.push({id:'t1',type:'EXPENSE',amount:100,category:'Продукты',occurred_on:'2026-10-21'});data={total_amount:100,created_count:1}
    }
    await route.fulfill({json:{data}})
  })
  return {requests,events,reminders,transactions,setFailBudget:(v:boolean)=>{failBudget=v}}
}

for(const width of [320,393])test(`home layout and creation work at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:852})
  const state=await mockHome(page)
  await page.goto('/')
  const budget=page.getByRole('region',{name:'Бюджет за месяц',exact:true})
  await expect(budget.locator('.h-donut')).toContainText('15 500')
  await expect(budget.locator('.h-legend li')).toHaveCount(6)
  await expect(budget.locator('.h-legend')).toContainText('Остальные')
  expect((await budget.locator('.h-chart').boundingBox())!.y).toBeLessThan((await budget.locator('.h-metrics').boundingBox())!.y)
  const plans=page.getByRole('region',{name:'Планы на сегодня'})
  await expect(plans.locator('article')).toHaveCount(2)
  await expect(plans).toContainText('10:00')
  await expect(plans).toContainText('17:00')
  await expect(page.getByText('Завтрашняя встреча',{exact:true})).toHaveCount(0)
  await expect(page.getByText('Отменённое напоминание',{exact:true})).toHaveCount(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`test-results/home-${width}.png`,fullPage:true})
  await plans.getByRole('button',{name:'＋ Добавить',exact:true}).click()
  await page.getByRole('dialog',{name:'Добавить план'}).getByRole('button',{name:'＋ Встреча',exact:true}).click()
  const form=page.getByRole('dialog',{name:'Новая встреча',exact:true})
  await form.getByLabel('Название',{exact:true}).fill('Новая встреча с главной')
  await form.getByLabel('Дата',{exact:true}).fill('2026-10-21')
  await form.getByLabel('Время',{exact:true}).fill('19:30')
  await form.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(form).toHaveCount(0)
  expect(state.events.at(-1)).toMatchObject({title:'Новая встреча с главной',start_at:'2026-10-21T16:30:00.000Z',responsible_member_ids:['m1']})
  await page.getByRole('button',{name:'Главная',exact:true}).click()
  await expect(page.getByRole('region',{name:'Планы на сегодня'})).toContainText('Новая встреча с главной')
  await page.getByRole('button',{name:'＋ Добавить',exact:true}).click()
  await page.getByRole('dialog',{name:'Добавить план'}).getByRole('button',{name:'＋ Напоминание',exact:true}).click()
  const reminder=page.getByRole('dialog',{name:'Новое напоминание',exact:true})
  await reminder.getByLabel('Название',{exact:true}).fill('Позвонить с главной')
  await reminder.getByLabel('Дата',{exact:true}).fill('2026-10-21')
  await reminder.getByLabel('Время',{exact:true}).fill('20:00')
  await reminder.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(reminder).toHaveCount(0)
  expect(state.reminders.at(-1)).toMatchObject({title:'Позвонить с главной',scheduled_at:'2026-10-21T17:00:00.000Z'})
  await page.getByRole('button',{name:'Главная',exact:true}).click()
  await expect(page.getByRole('region',{name:'Планы на сегодня'})).toContainText('Позвонить с главной')
  await page.getByRole('button',{name:'Кредиты →',exact:true}).click()
  await expect(page.getByRole('tab',{name:'Кредиты',exact:true})).toHaveAttribute('aria-selected','true')
})

for(const source of ['camera','gallery'])test(`home ${source} photo uploads once and confirmation creates expense`,async({page})=>{
  await page.setViewportSize({width:393,height:852})
  const state=await mockHome(page);await page.goto('/')
  await page.getByRole('button',{name:'Фото чека',exact:true}).click()
  const picker=page.getByRole('dialog',{name:'Добавить чек'})
  const photo=picker.getByLabel(source==='camera'?'Сфотографировать чек':'Загрузить чек с устройства',{exact:true})
  if(source==='camera')await expect(photo).toHaveAttribute('capture','environment')
  else await expect(photo).not.toHaveAttribute('capture')
  const image=Buffer.from(readFileSync('../backend/tests/Fixtures/receipt.png.b64','utf8'),'base64')
  await photo.setInputFiles({name:'home-receipt.png',mimeType:'image/png',buffer:image})
  await expect(picker).toHaveCount(0)
  await expect(page.getByRole('tab',{name:'Чеки',exact:true})).toHaveAttribute('aria-selected','true')
  await expect(page.getByText('Молоко',{exact:true})).toBeVisible()
  await expect(page.getByLabel('Категория позиции 1')).toHaveValue('c0')
  await page.screenshot({path:'test-results/home-receipt-review.png',fullPage:true})
  expect(state.requests.filter(x=>x.path==='/finance/receipts'&&x.method==='POST')).toHaveLength(1)
  await page.getByRole('button',{name:'Подтвердить расходы',exact:true}).click()
  await expect(page.getByText('Чек подтверждён. Добавлены расходы на 100 ₽.',{exact:true})).toBeVisible()
  expect(state.transactions).toHaveLength(1)
  await page.getByRole('button',{name:'Главная',exact:true}).click()
  await expect(page.locator('.h-metrics')).toContainText('15 600')
  await page.getByRole('button',{name:'Финансы',exact:true}).click()
  await expect(page.getByRole('tab',{name:'Обзор',exact:true})).toHaveAttribute('aria-selected','true')
  expect(state.requests.filter(x=>x.path==='/finance/receipts'&&x.method==='POST')).toHaveLength(1)
})

test('home empty state, budget failure and retry do not invent totals',async({page})=>{
  const state=await mockHome(page,{empty:true});state.setFailBudget(true);await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Бюджет: не удалось загрузить данные.')
  await expect(page.locator('.h-metrics')).toHaveCount(0)
  await expect(page.getByRole('region',{name:'Планы на сегодня'})).toContainText('На сегодня планов пока нет.')
  state.setFailBudget(false);await page.getByRole('button',{name:'Повторить',exact:true}).click()
  await expect(page.locator('.h-donut')).toContainText('0 ₽')
  await expect(page.getByText('Расходов пока нет',{exact:true})).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('home respects section visibility',async({page})=>{
  const state=await mockHome(page,{finance:false,calendar:false});await page.goto('/')
  await expect(page.getByRole('button',{name:'Открыть семью'})).toBeVisible()
  await expect(page.locator('.h-budget,.h-plans')).toHaveCount(0)
  expect(state.requests.some(x=>['/finance/analytics','/events','/reminders','/credits'].includes(x.path))).toBe(false)
})

test('home uses family timezone at a month boundary',async({page})=>{
  const state=await mockHome(page,{time:'2026-10-31T22:30:00Z',timezone:'Asia/Yekaterinburg'})
  state.events.push({id:'boundary',title:'Ноябрьская встреча',status:'SCHEDULED',start_at:'2026-10-31T23:00:00Z'})
  await page.goto('/')
  await expect(page.getByRole('region',{name:'Планы на сегодня'})).toContainText('Ноябрьская встреча')
  await expect(page.getByRole('region',{name:'Планы на сегодня'})).toContainText('04:00')
  expect(state.requests.find(x=>x.path==='/finance/analytics')?.search).toBe('?period=month&year=2026&month=11')
})

test('home reminder completion and undo persist in calendar',async({page})=>{
  await mockHome(page)
  await page.goto('/')
  await page.getByRole('checkbox',{name:'Выполнено: Забрать заказ',exact:true}).click()
  await expect(page.getByRole('checkbox',{name:'Выполнено: Забрать заказ',exact:true})).toHaveCount(0)
  await page.getByRole('status').getByRole('button',{name:'Отменить',exact:true}).click()
  await expect(page.getByRole('checkbox',{name:'Выполнено: Забрать заказ',exact:true})).toBeVisible()
  await page.getByRole('checkbox',{name:'Выполнено: Забрать заказ',exact:true}).click()
  await page.reload()
  await expect(page.getByRole('checkbox',{name:'Выполнено: Забрать заказ',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Календарь',exact:true}).click()
  await page.getByText('Выполнено · 1',{exact:true}).click()
  await page.getByRole('checkbox',{name:'Вернуть в планы: Забрать заказ',exact:true}).click()
  await page.getByRole('button',{name:'Главная',exact:true}).click()
  await expect(page.getByRole('checkbox',{name:'Выполнено: Забрать заказ',exact:true})).toBeVisible()
})
