import { expect, test } from '@playwright/test'

for(const state of ['ready','multiple','uncertain','timeout','unavailable'])test(`receipt without QR handles ${state}`,async({page})=>{
  const multiple=state==='multiple',uncertain=state==='uncertain',failure=state==='timeout'||state==='unavailable',empty=multiple||failure
  await page.setViewportSize({width:320,height:852})
  let confirms=0
  const receipt={id:'table',can_edit:true,qr_state:null,ocr_status:empty||uncertain?'NEEDS_REVIEW':'COMPLETED',created_at:'2026-10-24',review_payload:{recognition_source:'OCR',review_reason:multiple?'MULTIPLE_RECEIPTS':uncertain?'TOTAL_UNCERTAIN':failure?(state==='timeout'?'OCR_TIMEOUT':'OCR_UNAVAILABLE'):undefined,date:'2026-10-24',receipt_total:empty?null:435,items:empty?[]:[{name:'Йогурт',qty:2,price:120,category:'Продукты',category_id:'c1'},{name:'Апельсины',qty:.65,price:300,category:'Продукты',category_id:'c1'}]}}
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1','')
    let data:any=[]
    if(path==='/me')data={family:{id:'f1',role:'ADMIN'}}
    else if(path==='/finance/categories')data=[{id:'c1',name:'Продукты',transaction_type:'EXPENSE'}]
    else if(path==='/finance/analytics')data={ranked:[],trend:[]}
    else if(path==='/finance/receipts')data=[receipt]
    else if(path==='/finance/receipts/table')data=receipt
    else if(path==='/finance/receipts/table/confirm'){
      expect(req.postDataJSON().items.map((i:any)=>[i.qty,i.price])).toEqual([[2,120],[.65,300]])
      confirms++;data={total_amount:435,created_count:2}
    }
    await route.fulfill({json:{data}})
  })
  await page.goto('/?section=finance');await page.getByRole('tab',{name:'Чеки',exact:true}).click()
  await page.getByRole('button',{name:empty||uncertain?/Чек.*Нужна проверка/:/Чек.*Проверьте позиции/}).click()
  if(failure){
    await expect(page.getByText(state==='timeout'?'Сервер не успел обработать чек. Фото сохранено — нажмите «Распознать ещё раз».':'Распознавание на сервере сейчас недоступно. Фото сохранено — сообщите администратору.',{exact:true})).toBeVisible()
    await expect(page.getByText(/Загрузите чёткое фото/)).toHaveCount(0)
    await expect(page.getByRole('button',{name:'Подтвердить расходы',exact:true})).toBeDisabled()
    expect(confirms).toBe(0)
  }else if(multiple){
    await expect(page.getByText('На фото несколько чеков. Загрузите отдельное фото нужного чека целиком, чтобы не смешать покупки.',{exact:true})).toBeVisible()
    await expect(page.getByRole('button',{name:'Подтвердить расходы',exact:true})).toBeDisabled()
    await expect(page.getByText(/Фото сохранено, но позиции/)).toHaveCount(0)
    expect(confirms).toBe(0)
  }else{
    if(uncertain){
      await expect(page.getByRole('button',{name:'Подтвердить расходы',exact:true})).toBeDisabled()
      await expect(page.getByText(/Итог прочитан по-разному/)).toBeVisible()
      await page.getByLabel('Итог на чеке, ₽',{exact:true}).fill('436')
      await page.getByLabel('Итог на чеке, ₽',{exact:true}).fill('435')
    }
    await expect(page.locator('.f-receipt-line').filter({hasText:'Йогурт'})).toContainText('2 × 120 ₽')
    await expect(page.locator('.f-receipt-line').filter({hasText:'Апельсины'})).toContainText('0.65 × 300 ₽')
    await page.getByRole('button',{name:'Подтвердить расходы',exact:true}).click()
    await expect(page.getByText('Чек подтверждён. Добавлены расходы на 435 ₽.',{exact:true})).toBeVisible()
    expect(confirms).toBe(1)
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('suggested item categories stay editable and an unmatched item requires a deliberate choice',async({page})=>{
  let confirms=0
  const receipt={id:'classified',can_edit:true,ocr_status:'COMPLETED',qr_state:'READY',created_at:'2026-10-22',review_payload:{merchant:'Магазин',date:'2026-10-22',receipt_total:300,total:300,items:[
    {name:'Молоко',qty:1,price:100,category:'Продукты',category_id:'c0',category_needs_review:false},
    {name:'Таблетки',qty:1,price:100,category:'Здоровье',category_id:'c1',category_needs_review:false},
    {name:'XQ-179',qty:1,price:100,category:'',category_id:null,category_needs_review:true},
  ]}}
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1','')
    let data:any=[]
    if(path==='/me')data={family:{id:'f1',role:'ADMIN'}}
    else if(path==='/finance/categories')data=['Продукты','Здоровье','Покупки'].map((name,i)=>({id:'c'+i,name,transaction_type:'EXPENSE'}))
    else if(path==='/finance/analytics')data={total_income:0,total_expense:0,ranked:[],trend:[]}
    else if(path==='/finance/receipts')data=[receipt]
    else if(path==='/finance/receipts/classified')data=receipt
    else if(path==='/finance/receipts/classified/confirm'){
      expect(req.postDataJSON().items.map((i:any)=>i.category_id)).toEqual(['c0','c2','c2'])
      confirms++;data={total_amount:300,created_count:3}
    }
    await route.fulfill({json:{data}})
  })
  await page.goto('/?section=finance');await page.getByRole('tab',{name:'Чеки',exact:true}).click()
  await page.getByRole('button',{name:/Магазин.*Проверьте позиции/}).click()
  await expect(page.getByLabel('Категория позиции 1',{exact:true})).toHaveValue('c0')
  await expect(page.getByLabel('Категория позиции 2',{exact:true})).toHaveValue('c1')
  await expect(page.getByLabel('Категория позиции 3',{exact:true})).toHaveValue('')
  await expect(page.getByText('Выберите категорию позиции 3.',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Подтвердить расходы',exact:true})).toBeDisabled()
  expect(confirms).toBe(0)
  await page.getByLabel('Категория позиции 2',{exact:true}).selectOption('c2')
  await page.getByLabel('Категория позиции 3',{exact:true}).selectOption('c2')
  await page.getByRole('button',{name:'Подтвердить расходы',exact:true}).click()
  await expect(page.getByText('Чек подтверждён. Добавлены расходы на 300 ₽.',{exact:true})).toBeVisible()
  expect(confirms).toBe(1)
})

test('waiting electronic receipt updates to editable positions and confirms once',async({page})=>{
  await page.setViewportSize({width:320,height:852})
  await page.clock.install()
  let ready=false,confirmed=false,confirms=0
  const receipt=()=>({id:'qr1',can_edit:true,created_at:'2026-10-22',qr_state:ready?'READY':'WAITING',ocr_status:confirmed?'CONFIRMED':ready?'COMPLETED':'AWAITING_DATA',review_payload:{merchant:'Магазин',date:'2026-10-22',receipt_total:199.8,total:199.8,items:ready?[{name:'Молоко',qty:2,price:99.9,category:'Покупки'}]:[]}})
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1','')
    let data:any=[]
    if(path==='/me')data={family:{id:'f1',role:'ADMIN'}}
    else if(path==='/finance/categories')data=[{id:'c1',name:'Продукты',transaction_type:'EXPENSE'},{id:'c2',name:'Покупки',transaction_type:'EXPENSE'}]
    else if(path==='/finance/analytics')data={total_income:0,total_expense:0,ranked:[],trend:[]}
    else if(path==='/finance/receipts')data=[receipt()]
    else if(path==='/finance/receipts/qr1')data=receipt()
    else if(path==='/finance/receipts/qr1/confirm'){
      expect(req.postDataJSON().items[0].category_id).toBe('c1')
      confirmed=true;confirms++;data={total_amount:199.8,created_count:1}
    }
    await route.fulfill({json:{data}})
  })
  await page.goto('/?section=finance')
  await page.getByRole('tab',{name:'Чеки',exact:true}).click()
  await page.getByRole('button',{name:/Магазин.*Ожидаем данные чека/}).click()
  await expect(page.getByText(/QR-код прочитан. Ожидаем электронный чек/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Подтвердить расходы',exact:true})).toBeDisabled()
  await page.screenshot({path:'test-results/receipt-qr-waiting-320.png',fullPage:true})
  ready=true;await page.clock.runFor(16000)
  await expect(page.getByText('Молоко',{exact:true})).toBeVisible()
  await expect(page.getByText(/Получены позиции электронного чека/)).toBeVisible()
  await page.getByLabel('Категория позиции 1').selectOption('c1')
  await page.getByRole('button',{name:'Изменить позицию 1',exact:true}).click()
  const form=page.getByRole('dialog',{name:'Позиция 1',exact:true})
  await expect(form.getByLabel('Количество',{exact:true})).toHaveValue('2')
  await form.getByRole('button',{name:'Готово',exact:true}).click()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:'test-results/receipt-qr-ready-320.png',fullPage:true})
  await page.getByRole('button',{name:'Подтвердить расходы',exact:true}).click()
  await expect(page.getByText('Чек подтверждён. Добавлены расходы на 199,8 ₽.',{exact:true})).toBeVisible()
  expect(confirms).toBe(1)
})

test('local edits stop polling from replacing an open waiting receipt',async({page})=>{
  await page.clock.install()
  let reads=0
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1','')
    const receipt={id:'qr1',can_edit:true,qr_state:'WAITING',ocr_status:'AWAITING_DATA',review_payload:{receipt_total:100,items:[]}}
    let data:any=[]
    if(path==='/me')data={family:{id:'f1',role:'ADMIN'}}
    if(path==='/finance/categories')data=[{id:'c1',name:'Покупки',transaction_type:'EXPENSE'}]
    if(path==='/finance/analytics')data={ranked:[],trend:[]}
    if(path==='/finance/receipts')data=[receipt]
    if(path==='/finance/receipts/qr1'){reads++;data=receipt}
    await route.fulfill({json:{data}})
  })
  await page.goto('/?section=finance');await page.getByRole('tab',{name:'Чеки',exact:true}).click()
  await page.getByRole('button',{name:/Чек.*Ожидаем данные чека/}).click()
  await page.getByRole('button',{name:'Изменить данные чека'}).click()
  await page.getByRole('dialog').getByLabel('Магазин',{exact:true}).fill('Мои правки')
  await page.getByRole('dialog').getByRole('button',{name:'Готово',exact:true}).click()
  await page.clock.runFor(31000)
  await expect(page.getByText(/Мои правки ·/)).toBeVisible()
  expect(reads).toBe(1)
})
