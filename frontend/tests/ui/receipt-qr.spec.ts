import { expect, test } from '@playwright/test'

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
