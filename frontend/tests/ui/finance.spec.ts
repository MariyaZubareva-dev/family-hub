import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function mockFinance(page:Page) {
  const categories:any[]=[{id:'e1',name:'Продукты',transaction_type:'EXPENSE'},{id:'e2',name:'Покупки',transaction_type:'EXPENSE'},{id:'i1',name:'ЗП',transaction_type:'INCOME'},{id:'i2',name:'Премия',transaction_type:'INCOME'},{id:'i3',name:'Другое',transaction_type:'INCOME'}]
  const transactions:any[]=[],credits:any[]=[],receipts:any[]=[],requests:{path:string;body:any}[]=[]
  let budget:any={total_limit:0,spent_amount:0,available_amount:0,categories:[]}
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1',''),method=req.method()
    const body=method==='GET'||method==='DELETE'?null:req.postDataJSON()
    if(body)requests.push({path,body})
    let data:any=[]
    if(path==='/me')data={id:'u1',family:{id:'f1',role:'ADMIN',visibility:{calendar:true,shopping:true,finance:true}}}
    else if(path==='/finance/categories'){
      if(method==='POST')categories.push({id:'c'+categories.length,...body})
      data=method==='POST'?categories.at(-1):categories
    }else if(path==='/finances'){
      if(method==='POST')transactions.unshift({id:'t'+transactions.length,...body})
      data=method==='POST'?transactions[0]:transactions
    }else if(path==='/finance/analytics'){
      const income=transactions.filter(t=>t.type==='INCOME').reduce((s,t)=>s+Number(t.amount),0),expense=transactions.filter(t=>t.type==='EXPENSE').reduce((s,t)=>s+Number(t.amount),0)
      data={total_income:income,total_expense:expense,balance:income-expense,ranked:[],trend:[{month:'2026-10',label:'Окт',income,expense}]}
    }else if(path==='/credits'){
      if(method==='POST')credits.push({id:'credit'+credits.length,prepayments:[],...body})
      data=method==='POST'?credits.at(-1):credits
    }else if(path.match(/^\/credits\/[^/]+\/prepayments$/)){
      const c=credits.find(c=>path.includes(c.id));const p={id:'pre'+c.prepayments.length,...body};c.prepayments.push(p);data=p
    }else if(path.startsWith('/credit-prepayments/')){
      const p=credits.flatMap(c=>c.prepayments).find(p=>path.endsWith('/'+p.id));Object.assign(p,body);data=p
    }else if(path==='/finance/receipts'){
      if(method==='POST')receipts.push({id:'r1',can_edit:true,file_name:body.file_name,created_at:'2026-10-20',ocr_status:'COMPLETED',review_payload:{merchant:'Магазин',date:'2026-10-20',total:100,items:[{name:'Молоко',qty:1,price:100,category:'Продукты',category_id:'e1'}]}})
      data=method==='POST'?receipts.at(-1):receipts
    }else if(path.startsWith('/finance/receipts/')){
      const r=receipts.find(r=>path.includes('/'+r.id));data=r
      if(method==='DELETE'){receipts.splice(receipts.indexOf(r),1);data=null}
      if(method==='PATCH'){r.review_payload=body}
      if(path.endsWith('/confirm')){r.ocr_status='CONFIRMED';r.review_payload=body;data={total_amount:body.total,created_count:body.items.length};for(const i of body.items)transactions.push({id:'rt'+transactions.length,type:'EXPENSE',amount:i.qty*i.price,category:i.category,occurred_on:body.date})}
    }else if(path==='/finance/budgets/save'){
      budget={...body,spent_amount:0,available_amount:body.total_limit,categories:body.categories.map((c:any)=>({...c,name:categories.find(x=>x.id===c.category_id)?.name,spent_amount:0}))};data={budget}
    }else if(path.startsWith('/finance/budgets/'))data={budget}
    else if(path==='/planned-purchases')data=[{id:'p1',name:'Шампунь',due_date:'2026-11-01',last_purchased_at:'2026-10-01',type:'RECURRING'}]
    await route.fulfill({json:{data}})
  })
  return {categories,transactions,credits,receipts,requests}
}
const tab=(page:Page,name:string)=>page.getByRole('tab',{name,exact:true}).click()

test('income and expense categories persist and transaction forms use the correct list',async({page})=>{
  const state=await mockFinance(page)
  await page.goto('/?section=finance')
  await expect(page.getByRole('button',{name:'Обновить финансы'})).toBeEnabled()
  await tab(page,'Категории');await page.getByRole('button',{name:'Доходы',exact:true}).click()
  await expect(page.getByText('ЗП',{exact:true})).toBeVisible();await expect(page.getByText('Продукты',{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'＋ Категория',exact:true}).click()
  const cat=page.getByRole('dialog',{name:'Категория дохода'})
  await cat.getByLabel('Название').fill('Подработка');await cat.getByRole('button',{name:'Создать категорию'}).click()
  await expect(cat).toHaveCount(0);await expect(page.getByText('Подработка',{exact:true})).toBeVisible()
  await page.reload();await tab(page,'Обзор');await page.getByRole('button',{name:'＋ Доход',exact:true}).click()
  const tx=page.getByRole('dialog',{name:'Новый доход'})
  await expect(tx.getByLabel('Категория').locator('option')).toHaveText(['Выберите категорию','ЗП','Премия','Другое','Подработка'])
  await tx.getByLabel('Сумма, ₽').fill('50000');await tx.getByLabel('Категория').selectOption('i1');await tx.getByRole('button',{name:'Сохранить доход'}).click()
  await expect(tx).toHaveCount(0);expect(state.transactions[0]).toMatchObject({type:'INCOME',category:'ЗП',category_id:'i1',amount:50000})
  await page.getByRole('button',{name:'＋ Расход',exact:true}).click()
  const expense=page.getByRole('dialog',{name:'Новый расход'})
  await expect(expense.getByLabel('Категория').locator('option')).toHaveText(['Выберите категорию','Продукты','Покупки'])
  await expense.getByLabel('Сумма, ₽').fill('1200');await expense.getByLabel('Категория').selectOption('e1');await expense.getByRole('button',{name:'Сохранить расход'}).click()
  await expect(expense).toHaveCount(0);expect(state.transactions).toHaveLength(2)
  await expect(page.locator('.f-metrics')).toContainText('48 800 ₽')
  await page.reload();await expect(page.locator('.f-metrics')).toContainText('48 800 ₽')
})

test('photo review, draft edits and confirmation save actual expenses',async({page})=>{
  const state=await mockFinance(page);await page.goto('/?section=finance');await tab(page,'Чеки')
  const image=Buffer.from(readFileSync('../backend/tests/Fixtures/receipt.png.b64','utf8'),'base64')
  await page.getByLabel('Фото чека',{exact:true}).setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:image})
  await page.getByRole('button',{name:'Изменить позицию 1',exact:true}).click()
  await expect(page.getByLabel('Товар 1')).toHaveValue('Молоко')
  await page.getByLabel('Количество',{exact:true}).fill('2')
  await page.getByRole('button',{name:'Готово',exact:true}).click()
  await expect(page.getByRole('button',{name:'Подтвердить расходы'})).toBeDisabled()
  await page.getByRole('button',{name:'Изменить данные чека'}).click()
  await page.getByLabel('Итог на чеке, ₽').fill('200')
  await page.getByRole('button',{name:'Готово',exact:true}).click()
  await page.getByRole('button',{name:'Черновик',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('Черновик чека сохранён.')
  await page.getByRole('button',{name:'Закрыть чек'}).click();await page.getByRole('button',{name:/Магазин.*Проверьте позиции/}).click()
  await page.getByRole('button',{name:'Изменить позицию 1',exact:true}).click()
  await expect(page.getByLabel('Количество',{exact:true})).toHaveValue('2')
  await page.getByRole('button',{name:'Готово',exact:true}).click()
  await page.getByRole('button',{name:'Подтвердить расходы'}).click()
  await expect(page.getByText('Чек подтверждён. Добавлены расходы на 200 ₽.',{exact:true})).toBeVisible()
  expect(state.transactions).toHaveLength(1);expect(state.transactions[0].amount).toBe(200)
  expect(state.requests.find(r=>r.path==='/finance/receipts')?.body.image_data).toBe('data:image/png;base64,'+image.toString('base64'))
  await page.reload();await tab(page,'Чеки');await expect(page.getByText(/Расходы сохранены/)).toBeVisible()
})

test('credit, historical prepayment and its purpose persist after reload',async({page})=>{
  const state=await mockFinance(page);await page.goto('/?section=finance');await tab(page,'Кредиты')
  await page.getByRole('button',{name:'＋ Добавить',exact:true}).click()
  const form=page.getByRole('dialog',{name:'Новый кредит или рассрочка'})
  await form.getByRole('combobox',{name:'Тип',exact:true}).selectOption('INSTALLMENT');await form.getByLabel('Название',{exact:true}).fill('Рассрочка на технику')
  await form.getByLabel('Сумма, ₽',{exact:true}).fill('12000');await form.getByLabel('Срок, месяцев').fill('12');await form.getByLabel('Платёж в месяц, ₽').fill('1000')
  await form.getByLabel('Дата договора').fill('2026-01-01');await form.getByLabel('Первый платёж').fill('2026-02-01');await form.getByRole('button',{name:'Сохранить кредит'}).click()
  await expect(form).toHaveCount(0);await expect(page.getByRole('button',{name:/Рассрочка на технику/})).toBeVisible()
  await page.getByLabel('Дата платежа',{exact:true}).fill('2026-03-01');await page.getByLabel('Сумма, ₽',{exact:true}).fill('1500');await page.getByRole('button',{name:'Сохранить платёж',exact:true}).click()
  const purpose=page.getByLabel('Назначение платежа от 01.03.2026',{exact:true});await expect(purpose).toBeVisible();await purpose.selectOption('PAYMENT')
  await expect(purpose).toHaveValue('PAYMENT');await page.reload();await tab(page,'Кредиты');await expect(page.getByLabel('Назначение платежа от 01.03.2026',{exact:true})).toHaveValue('PAYMENT')
  expect(state.credits[0]).toMatchObject({type:'INSTALLMENT',annual_rate:0});expect(state.credits[0].prepayments).toHaveLength(1)
})

test('budget saves limits; stocks use shopping data and a tooltip instead of duplicate actions',async({page})=>{
  const state=await mockFinance(page);await page.goto('/?section=finance');await tab(page,'Бюджет')
  await page.getByRole('button',{name:'Настроить лимиты'}).click();await page.getByLabel('Общий лимит, ₽').fill('20000');await page.getByLabel('Лимит: Продукты',{exact:true}).fill('5000');await page.getByRole('button',{name:'Сохранить лимиты'}).click()
  await expect(page.getByText('Лимиты бюджета сохранены.',{exact:true})).toBeVisible()
  expect(state.requests.find(r=>r.path==='/finance/budgets/save')?.body).toMatchObject({total_limit:20000,categories:[{category_id:'e1',limit_amount:5000}]})
  await page.reload();await tab(page,'Бюджет');await expect(page.getByText('20 000 ₽',{exact:true})).toHaveCount(2)
  await tab(page,'Запасы');await expect(page.getByText('Шампунь',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/Купил|Товар/})).toHaveCount(0)
  await page.getByRole('button',{name:'Подсказка',exact:true}).click();await expect(page.getByRole('tooltip')).toContainText('«Покупки» → «Регулярные»');await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0)
})

for(const width of [320,393,768])test(`finance tabs, dialogs and prepayments fit ${width}px`,async({page})=>{
  const state=await mockFinance(page)
  state.credits.push({id:'c1',name:'Ипотека с очень длинным названием банка',principal:4800000,annual_rate:8,standard_payment:34825.63,term_months:240,type:'CREDIT',start_date:'2026-01-01',first_payment_date:'2026-02-01',recalculation_mode:'TERM',prepayments:[{id:'p1',paid_on:'2026-06-04',amount:20222.2,recalculation_mode:'PAYMENT'}]})
  await page.setViewportSize({width,height:852});await page.goto('/?section=finance');await expect(page.getByRole('button',{name:'Обновить финансы'})).toBeEnabled();await page.evaluate(()=>document.fonts.ready)
  await expect(page.getByText(/LIVE v07|Teal|POST \/|CoinKeeper/)).toHaveCount(0)
  for(const name of ['Обзор','Категории','Чеки','Запасы','Кредиты','Бюджет']){
    await tab(page,name);await expect(page.getByRole('tabpanel')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if(['Обзор','Категории','Кредиты'].includes(name))await page.screenshot({path:`test-results/finance-${name==='Обзор'?'overview':name==='Категории'?'categories':'credits'}-${width}.png`,fullPage:true})
    if(name==='Кредиты'){
      const bounds=await page.locator('.f-prepayment').evaluate(el=>{const date=el.querySelector('time')!.getBoundingClientRect(),amount=el.querySelector('b')!.getBoundingClientRect();return{dateRight:date.right,amountLeft:amount.left}})
      expect(bounds.dateRight).toBeLessThanOrEqual(bounds.amountLeft)
      await page.getByRole('button',{name:'＋ Добавить',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:`test-results/finance-credit-form-${width}.png`});await page.keyboard.press('Escape')
    }
  }
})

test('failed save keeps form data and shows a human-readable error',async({page})=>{
  await mockFinance(page);await page.route('**/api/v1/finances',async route=>{if(route.request().method()==='POST')await route.fulfill({status:500,json:{message:'SQLSTATE sensitive database error'}});else await route.fallback()})
  await page.goto('/?section=finance');await page.getByRole('button',{name:'＋ Доход',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Новый доход'});await dialog.getByLabel('Сумма, ₽').fill('100');await dialog.getByLabel('Категория').selectOption('i1');await dialog.getByRole('button',{name:'Сохранить доход'}).click()
  await expect(dialog.getByRole('alert')).toHaveText('Сервер временно недоступен. Попробуйте ещё раз позже.');await expect(dialog.getByLabel('Сумма, ₽')).toHaveValue('100');await expect(page.getByText(/SQLSTATE/)).toHaveCount(0)
})

for(const width of [320,393,768])test(`numbered receipt review is compact at ${width}px`,async({page})=>{
  const state=await mockFinance(page)
  state.receipts.push({id:'r2',file_name:'numbered.jpg',can_edit:true,created_at:'2026-10-21',ocr_status:'COMPLETED',review_payload:{date:'2026-10-17',total:8663,receipt_total:8663,items:[{name:'Пункт выдачи товаров',qty:1,price:1,category:'Покупки',category_id:'e2'},{name:'Кресло подвесное Ami БАУНТИ 325795859 1-но местное до 120 кг коричневый',qty:1,price:8662,category:'Покупки',category_id:'e2'}]}})
  await page.setViewportSize({width,height:852});await page.goto('/?section=finance');await tab(page,'Чеки')
  await page.getByRole('button',{name:/numbered.jpg.*Проверьте позиции/}).click()
  await page.evaluate(()=>document.fonts.ready)
  await expect(page.locator('.f-receipt-line')).toHaveCount(2)
  await expect(page.getByText('Сумма совпадает с чеком',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Подтвердить расходы'})).toBeEnabled()
  const sizes=await page.evaluate(()=>{
    const lines=[...document.querySelectorAll('.f-receipt-line')].map(el=>el.getBoundingClientRect().height)
    const card=document.querySelector('.f-receipts>.card')!.getBoundingClientRect()
    return {scroll:document.documentElement.scrollWidth,width:innerWidth,lines,cardHeight:card.height}
  })
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width)
  expect(Math.max(...sizes.lines)).toBeLessThanOrEqual(125)
  expect(sizes.cardHeight).toBeLessThan(520)
  await expect(page.getByRole('button',{name:'Подтвердить расходы'})).toBeInViewport()
  await page.screenshot({path:`test-results/receipt-review-${width}.png`,fullPage:true})
  await page.getByRole('button',{name:'Изменить позицию 2',exact:true}).click()
  const editor=page.getByRole('dialog',{name:'Позиция 2',exact:true})
  await expect(editor.getByLabel('Товар 2')).toHaveValue(/Кресло подвесное/)
  await editor.getByLabel('Цена, ₽').fill('8862');await editor.getByRole('button',{name:'Готово',exact:true}).click()
  await expect(page.getByRole('button',{name:'Подтвердить расходы'})).toBeDisabled()
  await expect(page.getByText(/На чеке 8.*663 ₽ — проверьте позиции/)).toBeVisible()
})

test('camera capture and draft deletion persist without creating expenses',async({page})=>{
  const state=await mockFinance(page);await page.goto('/?section=finance');await tab(page,'Чеки')
  const camera=page.getByLabel('Сфотографировать чек',{exact:true})
  await expect(camera).toHaveAttribute('capture','environment')
  await expect(page.getByLabel('Фото чека',{exact:true})).not.toHaveAttribute('capture')
  const image=Buffer.from(readFileSync('../backend/tests/Fixtures/receipt.png.b64','utf8'),'base64')
  await camera.setInputFiles({name:'camera.jpg',mimeType:'image/jpeg',buffer:image})
  await expect(page.getByRole('button',{name:'Подтвердить расходы'})).toBeEnabled()
  await page.getByRole('button',{name:'Удалить черновик Магазин',exact:true}).click()
  let dialog=page.getByRole('dialog',{name:'Удалить черновик?'})
  await dialog.getByRole('button',{name:'Отмена',exact:true}).click()
  expect(state.receipts).toHaveLength(1)
  await page.getByRole('button',{name:'Удалить черновик Магазин',exact:true}).click()
  dialog=page.getByRole('dialog',{name:'Удалить черновик?'})
  await dialog.getByRole('button',{name:'Удалить черновик',exact:true}).click()
  await expect(page.getByText('Черновик чека удалён.',{exact:true})).toBeVisible()
  expect(state.receipts).toHaveLength(0);expect(state.transactions).toHaveLength(0)
  await page.reload();await tab(page,'Чеки')
  await expect(page.getByText('Загруженных чеков пока нет.',{exact:true})).toBeVisible()
})
