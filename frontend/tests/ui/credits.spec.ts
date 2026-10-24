import {expect,test,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'

function forecastSample(mode:string,extra:any={}){return {kind:'ESTIMATE',recalculation_mode:mode,interest_policy:'NEXT_PAYMENT',original_last_payment_date:'2027-01-22',last_payment_date:mode==='TERM'?'2026-12-22':'2027-01-22',payment_before:200,payment_after:mode==='TERM'?200:166.67,payment_reduction:mode==='TERM'?0:33.33,term_reduction_months:mode==='TERM'?1:0,term_reduction_days:0,remaining_payments_before:3,remaining_payments_after:mode==='TERM'?2:3,final_payment_before:200,final_payment_after:200,final_payment_reduction:0,next_payment:{date:'2026-11-22',payment:mode==='TERM'?200:166.67},bank_snapshot_date:'2026-10-04',interest_saved:12.5,prepayment:{principal:100},assumptions:['Обычные платежи вносятся вовремя.'],rows:[],...extra}}

async function setup(page:Page){
  const today=new Date().toLocaleDateString('sv-SE')
  const credit:any={id:'c1',name:'Техника',type:'INSTALLMENT',principal:600,annual_rate:0,standard_payment:200,term_months:3,start_date:'2026-01-01',first_payment_date:'2026-02-01',recalculation_mode:'TERM',payments:[],prepayments:[{id:'early',paid_on:'2026-03-01',amount:100,recalculation_mode:'TERM'}],summary:{last_payment_date:'2026-04-01',last_paid_on:'2026-03-01',next_payment:{date:today,amount:200}}}
  const requests:any[]=[]
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1',''),method=req.method(),body=['GET','DELETE'].includes(method)?null:req.postDataJSON();requests.push({path,method,body})
    let data:any=[]
    if(path==='/me')data={id:'u1',family:{id:'f1',role:'ADMIN',visibility:{calendar:true,shopping:true,finance:true}}}
    else if(path==='/credits')data=[credit]
    else if(path==='/credits/c1'&&method==='PATCH'){Object.assign(credit,body);data=credit}
    else if(path==='/credits/c1/payments'){data={...body,id:'pay1'};credit.payments.push(data);credit.summary.last_paid_on=body.paid_on}
    else if(path==='/credits/c1/prepayments'){data={...body,id:'early2'};credit.prepayments.push(data)}
    else if(path==='/credits/c1/schedule-payment'){
      if(!body.paid)credit.payments=credit.payments.filter((p:any)=>p.scheduled_on!==body.scheduled_on)
      else if(!credit.payments.some((p:any)=>p.scheduled_on===body.scheduled_on))credit.payments.push({id:'mark1',scheduled_on:body.scheduled_on,paid_on:body.paid_on,amount:credit.bank_schedule.rows.find((r:any)=>r.date===body.scheduled_on).payment})
      data=credit.summary
    }
    else if(path==='/credit-payments/pay1'){if(method==='DELETE')credit.payments=[];else{Object.assign(credit.payments[0],body);data=credit.payments[0]}}
    else if(path==='/credit-prepayments/early'){if(method==='DELETE')credit.prepayments=[];else{Object.assign(credit.prepayments[0],body);data=credit.prepayments[0]}}
    else if(path==='/credits/c1/bank-schedule'){credit.bank_schedule={...body,version:1,complete:true,stale:false};data=credit.bank_schedule}
    else if(path==='/credits/c1/forecast')data=forecastSample(body.recalculation_mode)
    else if(path==='/finance/analytics')data={total_income:0,total_expense:0,ranked:[],trend:[]}
    if(method==='DELETE'){await route.fulfill({status:204});return}
    await route.fulfill({json:{data}})
  })
  await page.goto('/?section=finance');await page.getByRole('tab',{name:'Кредиты',exact:true}).click()
  return {credit,requests,today}
}
test('history creates, edits and removes monthly and early payment records',async({page})=>{
  const state=await setup(page)
  await page.getByRole('tab',{name:'История',exact:true}).click();await page.getByRole('button',{name:'＋ Ежемесячный платёж',exact:true}).click()
  let dialog=page.getByRole('dialog',{name:'Ежемесячный платёж',exact:true})
  await dialog.getByLabel('Дата по графику',{exact:true}).fill(state.today);await dialog.getByLabel('Сумма оплаты, ₽').fill('200');await dialog.getByLabel('Комментарий').fill('Банк списал платёж');await dialog.getByRole('button',{name:'Сохранить оплату'}).click()
  await expect(dialog).toHaveCount(0);expect(state.credit.payments).toHaveLength(1)
  const payment=page.locator('.credit-history-row').filter({hasText:'Банк списал платёж'})
  await payment.getByRole('button',{name:/Изменить оплату/}).click();dialog=page.getByRole('dialog',{name:'Изменить оплату'});await dialog.getByLabel('Сумма оплаты, ₽').fill('150');await dialog.getByRole('button',{name:'Сохранить оплату'}).click();await expect(dialog).toHaveCount(0);expect(state.credit.payments[0].amount).toBe(150)
  await payment.getByRole('button',{name:/Изменить оплату/}).click();await page.getByRole('dialog').getByRole('button',{name:'Удалить оплату',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Удалить платёж',exact:true}).click();await expect(payment).toHaveCount(0)
  await page.getByRole('button',{name:'Изменить досрочный платёж от 01.03.2026'}).click();await page.getByRole('dialog').getByRole('button',{name:'Удалить оплату',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Удалить платёж',exact:true}).click();expect(state.credit.prepayments).toHaveLength(0)
  expect(state.requests.some(r=>r.path==='/finances'&&r.method==='POST')).toBe(false)
})
test('bank payment is shown in full separately from remaining amount and the projected end date',async({page})=>{
  const state=await setup(page)
  state.credit.bank_schedule={as_of:'2026-10-04',complete:true,stale:true,rows:[{date:'2048-03-04',payment:56592.34,principal:50000,interest:6592.34,fees:0,balance:0}]}
  state.credit.summary={last_payment_date:'2048-03-04',last_paid_on:'2026-10-04',next_payment:{date:'2026-11-04',planned_amount:56592.34,paid_amount:49174.71,amount:7417.63},estimated_last_payment_date:'2045-02-04',estimated_next_payment:{date:'2026-11-04',payment:56592.34}}
  await page.reload();await page.getByRole('tab',{name:'Кредиты',exact:true}).click();await page.setViewportSize({width:320,height:852})
  await expect(page.locator('.credit-hero-amount')).toContainText('56 592,34 ₽')
  await expect(page.locator('.credit-remaining')).toContainText('7 417,63 ₽')
  await expect(page.locator('.credit-key-metrics')).toContainText('04.02.2045')
  await page.getByRole('tab',{name:'Данные',exact:true}).click();await expect(page.locator('.f-row').filter({hasText:'Дата полного погашения'})).toContainText('04.03.2048')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('bank snapshot history is paid and does not create a false remaining balance on the next payment',async({page})=>{
  const state=await setup(page)
  state.credit.bank_schedule={as_of:'2026-10-04',opening_balance:400,complete:true,version:1,rows:[{date:'2026-11-04',payment:200,principal:200,interest:0,fees:0,balance:200},{date:'2026-12-04',payment:200,principal:200,interest:0,fees:0,balance:0}]}
  state.credit.payments=[{id:'pay1',scheduled_on:'2026-11-04',paid_on:'2026-10-04',amount:150}]
  state.credit.summary={last_payment_date:'2026-12-04',next_payment:{date:'2026-11-04',planned_amount:200,paid_amount:0,amount:200},payment_history:[{...state.credit.payments[0],included_in_bank_snapshot:true,display_scheduled_on:'2026-10-04'}],regular_schedule:[{date:'2026-10-04',payment:150,paid_amount:150,remaining_amount:0,status:'PAID',source:'JOURNAL'},{date:'2026-11-04',payment:200,paid_amount:0,remaining_amount:200,status:'UPCOMING'},{date:'2026-12-04',payment:200,paid_amount:0,remaining_amount:200,status:'UPCOMING'}]}
  await page.reload();await page.getByRole('tab',{name:'Кредиты',exact:true}).click();await page.setViewportSize({width:320,height:852})
  await expect(page.locator('.credit-hero-amount')).toHaveText('200 ₽');await expect(page.locator('.credit-remaining')).toHaveCount(0)
  await page.getByRole('button',{name:'Отметить оплату',exact:true}).click();await expect(page.getByRole('dialog',{name:'Отметить оплату'})).toContainText('04.11.2026');await page.keyboard.press('Escape')
  await page.screenshot({path:'test-results/credit-redesign-320.png',fullPage:true})
  await page.getByRole('tab',{name:'История',exact:true}).click();const row=page.locator('.credit-history-row').filter({hasText:'Учтено банком'});await expect(row).toContainText('04.10.2026');await expect(row).not.toContainText('04.11.2026')
  await expect(page.getByText('Оплаченных платежей пока нет.',{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('new and edited prepayments save the bank interest policy',async({page})=>{
  const state=await setup(page);await page.getByRole('button',{name:'Досрочный платёж',exact:true}).click()
  let dialog=page.getByRole('dialog',{name:'Досрочный платёж',exact:true});await dialog.getByLabel('Сумма оплаты, ₽').fill('100');await dialog.getByLabel('Проценты при досрочном платеже').selectOption('FROM_PREPAYMENT');await dialog.getByRole('button',{name:'Сохранить платёж',exact:true}).click()
  await expect.poll(()=>state.requests.find(r=>r.path==='/credits/c1/prepayments')?.body.interest_policy).toBe('FROM_PREPAYMENT')
  await page.getByRole('tab',{name:'История',exact:true}).click();await page.getByRole('button',{name:'Изменить досрочный платёж от 01.03.2026'}).click();dialog=page.getByRole('dialog',{name:'Изменить досрочный платёж',exact:true})
  await dialog.getByLabel('Проценты при досрочном платеже').selectOption('NEXT_PAYMENT');await dialog.getByRole('button',{name:'Сохранить оплату'}).click();await expect(dialog).toHaveCount(0);expect(state.credit.prepayments[0].interest_policy).toBe('NEXT_PAYMENT')
})
test('monthly contractual amount is editable and persists on reload',async({page})=>{
  const state=await setup(page)
  await page.getByRole('button',{name:'Изменить условия кредита'}).click()
  const dialog=page.getByRole('dialog',{name:'Условия кредита'});await dialog.getByLabel('Платёж в месяц, ₽').fill('210');await dialog.getByRole('button',{name:'Сохранить кредит'}).click()
  await expect(dialog).toHaveCount(0);expect(state.credit.standard_payment).toBe(210)
  await page.reload();await page.getByRole('tab',{name:'Кредиты',exact:true}).click();await page.getByRole('tab',{name:'Данные',exact:true}).click();await expect(page.locator('.f-row').filter({hasText:'Платёж по договору'})).toContainText('210 ₽')
})
test('schedule checkbox preserves its selected period across another payment date, reload and undo',async({page})=>{
  const state=await setup(page)
  state.credit.bank_schedule={as_of:'2026-10-01',version:1,complete:true,stale:false,rows:[{date:'2026-10-04',payment:200,principal:200,interest:0,fees:0,balance:200},{date:'2026-11-04',payment:200,principal:200,interest:0,fees:0,balance:0}]}
  await page.reload();await page.getByRole('tab',{name:'Кредиты',exact:true}).click();await page.setViewportSize({width:320,height:852})
  await page.getByRole('button',{name:'Все даты',exact:true}).click()
  await page.getByRole('checkbox',{name:'Оплачен платёж 04.10.2026',exact:true}).click()
  let dialog=page.getByRole('dialog',{name:'Отметить оплату',exact:true})
  await dialog.getByLabel('Дата фактической оплаты').fill('2026-10-20');await dialog.getByRole('button',{name:'Оплачено',exact:true}).click();await expect(dialog).toHaveCount(0)
  expect(state.credit.payments[0]).toMatchObject({scheduled_on:'2026-10-04',paid_on:'2026-10-20',amount:200})
  await page.reload();await page.getByRole('tab',{name:'Кредиты',exact:true}).click();await page.getByRole('button',{name:'Все даты',exact:true}).click()
  await expect(page.getByRole('checkbox',{name:'Оплачен платёж 04.10.2026',exact:true})).toBeChecked();await expect(page.getByRole('checkbox',{name:'Оплачен платёж 04.11.2026',exact:true})).not.toBeChecked()
  await page.getByRole('checkbox',{name:'Оплачен платёж 04.10.2026',exact:true}).click();dialog=page.getByRole('dialog',{name:'Снять отметку оплаты?'})
  await dialog.getByRole('button',{name:'Снять отметку',exact:true}).click();await expect(dialog).toHaveCount(0);expect(state.credit.payments).toHaveLength(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('calculator remains usable after recorded prepayments without uploading the same graph again',async({page})=>{
  const state=await setup(page);state.credit.bank_schedule={as_of:'2026-03-01',complete:true,stale:true,stale_reason:'PREPAYMENTS',rows:[]}
  await page.reload();await page.getByRole('tab',{name:'Кредиты',exact:true}).click();await page.getByRole('button',{name:'Расчёт досрочного погашения',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Расчёт досрочного погашения',exact:true});await dialog.getByLabel('Досрочная сумма, ₽').fill('100');await dialog.getByLabel('Как будут оплачены проценты').selectOption('NEXT_PAYMENT');await dialog.getByRole('button',{name:'Рассчитать',exact:true}).click();await expect(dialog).toContainText('Предварительный расчёт')
})
for(const [width,height] of [[320,480],[320,852],[393,852]])for(const mode of ['TERM','PAYMENT'])test(`calculator shows before, after and an explicit ${mode} reduction at ${width}x${height}`,async({page})=>{
  const state=await setup(page);state.credit.bank_schedule={as_of:'2026-10-04',complete:true,stale:true,stale_reason:'PREPAYMENTS',rows:[]}
  await page.setViewportSize({width,height});await page.reload();await page.getByRole('tab',{name:'Кредиты',exact:true}).click();await page.getByRole('button',{name:'Расчёт досрочного погашения',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Расчёт досрочного погашения',exact:true});await expect(dialog.getByLabel('Как будут оплачены проценты')).toHaveValue('AUTO')
  await dialog.getByLabel('Досрочная сумма, ₽').fill('100');await dialog.getByRole('combobox',{name:'Что уменьшить',exact:true}).selectOption(mode);await dialog.getByRole('button',{name:'Рассчитать',exact:true}).click()
  const result=dialog.getByRole('region',{name:'Результат расчёта'});await expect(result.locator('.credit-impact strong')).toHaveText(mode==='TERM'?'1 месяц':'33,33 ₽');await expect(result.locator('.credit-impact strong')).toBeInViewport()
  await expect(result.locator('.credit-impact-compare')).toContainText(mode==='TERM'?'22.01.2027':'200 ₽');await expect(result.locator('.credit-impact-compare')).toContainText(mode==='TERM'?'22.12.2026':'166,67 ₽')
  expect(state.requests.find(r=>r.path==='/credits/c1/forecast')?.body.interest_policy).toBe('AUTO');await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`test-results/forecast-${mode}-${width}-${height}.png`})
  await dialog.getByLabel('Досрочная сумма, ₽').fill('10');await expect(result).toHaveCount(0)
})
test('calculator explains when the final payment falls but the payoff date does not move',async({page})=>{
  const state=await setup(page);state.credit.bank_schedule={complete:true,rows:[]}
  await page.route('**/api/v1/credits/c1/forecast',route=>route.fulfill({json:{data:forecastSample('TERM',{last_payment_date:'2027-01-22',term_reduction_months:0,remaining_payments_after:3,final_payment_after:190,final_payment_reduction:10})}}))
  await page.reload();await page.getByRole('tab',{name:'Кредиты',exact:true}).click();await page.getByRole('button',{name:'Расчёт досрочного погашения',exact:true}).click();const dialog=page.getByRole('dialog')
  await dialog.getByLabel('Досрочная сумма, ₽').fill('10');await dialog.getByRole('button',{name:'Рассчитать',exact:true}).click()
  await expect(dialog.locator('.credit-impact strong')).toHaveText('Не изменится');await expect(dialog.locator('.credit-last-payment')).toContainText('Последний платёж меньше на 10 ₽');await expect(dialog.locator('.credit-last-payment')).toContainText('200 ₽ → 190 ₽')
})
test('unknown bank rule shows both distinct outcomes and a tooltip with a concrete example',async({page})=>{
  const state=await setup(page);state.credit.bank_schedule={complete:true,rows:[]}
  await page.route('**/api/v1/credits/c1/forecast',route=>route.fulfill({json:{data:{...forecastSample('PAYMENT'),interest_policy:'AUTO',policy_changes_result:true,policy_errors:[],policy_variants:[forecastSample('PAYMENT',{payment_after:160,payment_reduction:40}),forecastSample('PAYMENT',{interest_policy:'FROM_PREPAYMENT',payment_after:165,payment_reduction:35})]}}}))
  await page.reload();await page.getByRole('tab',{name:'Кредиты',exact:true}).click();await page.getByRole('button',{name:'Расчёт досрочного погашения',exact:true}).click();const dialog=page.getByRole('dialog')
  await dialog.getByRole('button',{name:'Как выбрать оплату процентов',exact:true}).click();await expect(page.getByRole('tooltip')).toContainText('10 000 ₽');await dialog.getByRole('button',{name:'Как выбрать оплату процентов',exact:true}).click()
  await dialog.getByLabel('Досрочная сумма, ₽').fill('100');await dialog.getByRole('button',{name:'Рассчитать',exact:true}).click()
  await expect(dialog.getByRole('region',{name:'Проценты — в обычном платеже'}).locator('.credit-impact strong')).toHaveText('40 ₽');await expect(dialog.getByRole('region',{name:'Проценты — из досрочной суммы'}).locator('.credit-impact strong')).toHaveText('35 ₽')
})
test('bank CSV validates columns, saves graph and requires an explicit interest policy for estimate',async({page})=>{
  const state=await setup(page);await page.setViewportSize({width:320,height:852})
  await page.getByRole('button',{name:'Расчёт досрочного погашения',exact:true}).click()
  await expect(page.getByRole('dialog')).toContainText('Для расчёта загрузите полный график');await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click()
  await page.getByRole('tab',{name:'Данные',exact:true}).click();await page.getByRole('button',{name:'Добавить график',exact:true}).click()
  let dialog=page.getByRole('dialog',{name:'График банка',exact:true})
  await dialog.getByLabel('Дата; платёж; долг; проценты; услуги; остаток').fill('неверная строка');await dialog.getByRole('button',{name:'Проверить строки'}).click();await expect(dialog.getByRole('alert')).toContainText('шесть столбцов')
  await dialog.getByLabel('Дата остатка').fill(state.today)
  await dialog.getByLabel('Загрузить CSV').setInputFiles({name:'bank.csv',mimeType:'text/csv',buffer:Buffer.from('2026-11-22;200;200;0;0;400\n2026-12-22;200;200;0;0;200\n2027-01-22;200;200;0;0;0')})
  await dialog.getByRole('button',{name:'Проверить строки'}).click();await expect(dialog.locator('tbody tr')).toHaveCount(3)
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Сохранить график'}).click();await expect(dialog).toHaveCount(0)
  expect(state.credit.bank_schedule.rows).toHaveLength(3)
  await page.getByRole('button',{name:'Расчёт досрочного погашения',exact:true}).click();dialog=page.getByRole('dialog',{name:'Расчёт досрочного погашения',exact:true})
  await dialog.getByLabel('Досрочная сумма, ₽').fill('100');await dialog.getByLabel('Как будут оплачены проценты').selectOption('FROM_PREPAYMENT');await dialog.getByRole('button',{name:'Рассчитать',exact:true}).click()
  await expect(dialog).toContainText('Предварительный расчёт');expect(state.requests.find(r=>r.path.endsWith('/forecast')).body.interest_policy).toBe('FROM_PREPAYMENT')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('PDF chosen through CSV upload is recognized; origination and historical rows become the opening balance',async({page})=>{
  const state=await setup(page)
  await page.route('**/api/v1/credits/c1/bank-schedule/import-pdf',route=>route.fulfill({json:{data:{source:'PDF_TEXT',pages:2,column_count:4,skipped_lines:0,warnings:[],rows:[{date:'2026-01-01',values:[0,0,0,600]},{date:'2026-02-01',values:[200,0,200,400]},{date:'2026-03-01',values:[200,0,200,200]},{date:'2027-01-22',values:[200,0,200,0]}]}}}))
  await page.getByRole('tab',{name:'Данные',exact:true}).click();await page.getByRole('button',{name:'Добавить график',exact:true}).click();const dialog=page.getByRole('dialog',{name:'График банка',exact:true})
  await dialog.getByLabel('Загрузить CSV').setInputFiles({name:'schedule.pdf',mimeType:'application/pdf',buffer:Buffer.from(readFileSync('../backend/tests/Fixtures/credit-schedule.pdf.b64','utf8').trim(),'base64')})
  const review=dialog.getByRole('region',{name:'Проверка PDF'});await expect(review).toBeVisible()
  await review.getByLabel('Платёж',{exact:true}).selectOption('2');await review.getByLabel('Основной долг',{exact:true}).selectOption('0');await review.getByLabel('Проценты',{exact:true}).selectOption('1');await review.getByLabel('Остаток после платежа',{exact:true}).selectOption('3');await review.getByRole('button',{name:'Перенести в график'}).click()
  await expect(dialog.getByLabel('Основной долг, ₽')).toHaveValue('200');await expect(dialog.getByLabel('Дата остатка')).toHaveValue('2026-03-01')
  await expect(dialog.getByRole('textbox',{name:'Дата; платёж; долг; проценты; услуги; остаток'})).not.toHaveValue(/%PDF/)
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Сохранить график'}).click();await expect(dialog).toHaveCount(0)
  expect(state.credit.bank_schedule.rows).toHaveLength(1);expect(state.credit.bank_schedule.as_of).toBe('2026-03-01')
})

test('PDF upload shows progress, maps bank columns, preserves existing data on a wrong mapping and saves only after review',async({page})=>{
  const state=await setup(page)
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/api/v1/credits/c1/bank-schedule/import-pdf',async route=>{await pending;await route.fulfill({json:{data:{source:'PDF_TEXT',pages:2,column_count:5,skipped_lines:0,warnings:['Сверьте график с документом.'],rows:[{date:'2026-11-22',values:[0,400,200,200,0]},{date:'2026-12-22',values:[0,200,200,200,0]},{date:'2027-01-22',values:[0,0,200,200,0]}]}}})})
  await page.setViewportSize({width:320,height:700});await page.getByRole('tab',{name:'Данные',exact:true}).click();await page.getByRole('button',{name:'Добавить график',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'График банка',exact:true})
  await dialog.getByLabel('Загрузить PDF').setInputFiles({name:'schedule.pdf',mimeType:'application/pdf',buffer:Buffer.from(readFileSync('../backend/tests/Fixtures/credit-schedule.pdf.b64','utf8').trim(),'base64')})
  await expect(dialog.getByRole('status')).toContainText('Извлекаем график из PDF')
  await expect(dialog.getByRole('button',{name:'Сохранить график'})).toBeDisabled();release()
  const review=dialog.getByRole('region',{name:'Проверка PDF'})
  await expect(review).toBeVisible();await expect(review).toContainText('3 строк')
  await review.getByLabel('Платёж',{exact:true}).selectOption('2');await review.getByLabel('Основной долг',{exact:true}).selectOption('3');await review.getByLabel('Проценты',{exact:true}).selectOption('0');await review.getByLabel('Услуги',{exact:true}).selectOption('4');await review.getByLabel('Остаток после платежа',{exact:true}).selectOption('4')
  await review.getByRole('button',{name:'Перенести в график'}).click();await expect(dialog.getByRole('alert')).toContainText('разные столбцы')
  expect(state.requests.some(r=>r.path==='/credits/c1/bank-schedule'&&r.method==='PUT')).toBe(false)
  await review.getByLabel('Остаток после платежа',{exact:true}).selectOption('1');await review.getByRole('button',{name:'Перенести в график'}).click()
  await expect(review).toHaveCount(0);await expect(dialog.getByLabel('Основной долг, ₽')).toHaveValue('600');await expect(dialog.getByLabel('Дата остатка')).toHaveValue('')
  await dialog.getByLabel('Дата остатка').fill(state.today);await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Сохранить график'}).click()
  await expect(dialog).toHaveCount(0);expect(state.credit.bank_schedule.rows).toHaveLength(3);expect(state.credit.bank_schedule.rows[0]).toMatchObject({principal:200,interest:0,payment:200,balance:400})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
