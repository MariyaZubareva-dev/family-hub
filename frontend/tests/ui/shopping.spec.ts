import { expect, test, type Page } from '@playwright/test'

async function mockShopping(page:Page){
  const categories=[{id:'c1',name:'Для дома'},{id:'c2',name:'Подарки'}]
  const items:any[]=[{id:'p1',type:'LARGE',name:'Очень длинное название покупки для проверки переноса на узком экране',category:'Для дома',estimated_amount:'125000.50',due_date:'2026-12-01',creator:{first_name:'Мария'}},{id:'p2',type:'RECURRING',name:'Бумага',category:'Для дома',estimated_amount:'350',due_date:'2026-11-21',cadence_months:3}]
  const requests:{path:string;body:any}[]=[]
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname
    let data:any=[]
    if(path.endsWith('/me'))data={family:{id:'f1',role:'ADMIN',visibility:{finance:true,shopping:true,calendar:true}}}
    else if(path.endsWith('/planned-purchases/categories')){
      if(req.method()==='POST'){const body=req.postDataJSON();requests.push({path,body});const cat={id:'c'+(categories.length+1),name:body.name};categories.push(cat);data=cat}else data=categories
    }else if(path.endsWith('/purchased')){
      const body=req.postDataJSON();requests.push({path,body});data=items.find(x=>path.includes('/'+x.id+'/'));data.due_date='2027-01-21'
    }else if(req.method()==='PATCH'){
      const body=req.postDataJSON();requests.push({path,body});data=items.find(x=>path.endsWith('/'+x.id));Object.assign(data,body,{estimated_amount:body.unit_price==null?null:String(body.unit_price*body.quantity)})
    }else if(path.endsWith('/planned-purchases')){
      if(req.method()==='POST'){const body=req.postDataJSON();requests.push({path,body});data={...body,estimated_amount:body.type==='RECURRING'?(body.unit_price==null?null:String(body.unit_price*body.quantity)):body.estimated_amount,id:'p'+(items.length+1)};items.push(data)}else data=items
    }
    await route.fulfill({json:{data}})
  })
  return requests
}

for(const width of [320,393,768]){
  test(`shopping and both forms fit ${width}px and reuse saved categories`,async({page})=>{
    await page.setViewportSize({width,height:852})
    const requests=await mockShopping(page)
    await page.goto('/?section=lists')
    await expect(page.getByRole('tab',{name:'Магазин',exact:true})).toHaveAttribute('aria-selected','true')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('tab',{name:'Крупные',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Крупные покупки и подарки 1'})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({path:`test-results/shopping-large-${width}.png`,fullPage:true})
    await page.getByRole('button',{name:'＋ Добавить',exact:true}).click()
    const dialog=page.getByRole('dialog',{name:'Добавить покупку или подарок'})
    await expect(dialog.getByRole('textbox',{name:'Название',exact:true})).toBeFocused()
    await dialog.getByRole('textbox',{name:'Название',exact:true}).fill('Забор')
    const select=dialog.getByRole('combobox',{name:'Категория',exact:true})
    await expect(select.locator('option:checked')).toHaveText('Выберите категорию')
    await expect(select.locator('option')).toContainText(['Добавить новую категорию','Выберите категорию','Для дома','Подарки'])
    expect(await select.locator('option').first().textContent()).toContain('Добавить новую категорию')
    await select.selectOption('__new__')
    await dialog.getByRole('textbox',{name:'Название новой категории'}).fill('Участок')
    await page.screenshot({path:`test-results/shopping-new-category-${width}.png`,fullPage:true})
    await dialog.getByRole('button',{name:'Добавить категорию',exact:true}).click()
    await expect(select).toHaveValue('Участок')
    await dialog.getByRole('spinbutton',{name:'Сумма, ₽'}).fill('12500.50')
    await dialog.getByLabel('Плановая дата',{exact:true}).fill('2026-12-01')
    await page.screenshot({path:`test-results/shopping-form-large-${width}.png`,fullPage:true})
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(Math.min(420,width))
    await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
    await expect(dialog).toHaveCount(0)
    expect(requests[0]).toEqual({path:'/api/v1/planned-purchases/categories',body:{name:'Участок'}})
    expect(requests[1].body).toMatchObject({name:'Забор',type:'LARGE',category:'Участок',estimated_amount:12500.5,due_date:'2026-12-01'})
    await page.reload()
    await expect(page.getByRole('tab',{name:'Магазин',exact:true})).toHaveAttribute('aria-selected','true')
    await page.getByRole('tab',{name:'Крупные',exact:true}).click()
    await expect(page.getByText('Забор',{exact:true})).toBeVisible()
    await page.getByRole('tab',{name:'Регулярные',exact:true}).click()
    await page.getByRole('button',{name:'＋ Добавить',exact:true}).click()
    const recurring=page.getByRole('dialog',{name:'Добавить регулярную покупку'})
    await recurring.getByRole('textbox',{name:'Название',exact:true}).fill('Туалетная бумага')
    await recurring.getByRole('combobox',{name:'Категория',exact:true}).selectOption({label:'Участок'})
    await recurring.getByLabel('Следующая дата',{exact:true}).fill('2026-12-21')
    await recurring.getByRole('spinbutton',{name:'Каждые, мес.'}).fill('3')
    await recurring.getByLabel('Цена за штуку, ₽').fill('250.15')
    await recurring.getByLabel('Количество, шт.').fill('3')
    await expect(recurring.locator('output')).toHaveText('750,45 ₽')
    await page.screenshot({path:`test-results/shopping-form-recurring-${width}.png`,fullPage:true})
    await recurring.getByRole('button',{name:'Сохранить',exact:true}).click()
    await expect(recurring).toHaveCount(0)
    expect(requests[2].body).toMatchObject({name:'Туалетная бумага',type:'RECURRING',category:'Участок',cadence_months:3,unit_price:250.15,quantity:3})
    await expect(page.locator('article').filter({hasText:'Туалетная бумага'})).toContainText('750,45 ₽')
    await page.getByRole('button',{name:'Отметить покупку: Бумага',exact:true}).click()
    await expect(page.getByRole('status')).toContainText('Следующая дата:')
    expect(requests[3].path).toBe('/api/v1/planned-purchases/p2/purchased')
    await page.screenshot({path:`test-results/shopping-recurring-${width}.png`,fullPage:true})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}

test('shopping preserves draft on errors and category cancellation; short dialog scrolls',async({page})=>{
  await page.setViewportSize({width:320,height:480})
  await mockShopping(page)
  await page.goto('/?section=lists')
  await page.getByRole('tab',{name:'Регулярные',exact:true}).click()
  const trigger=page.getByRole('button',{name:'＋ Добавить',exact:true})
  await trigger.click()
  const dialog=page.getByRole('dialog')
  await dialog.getByRole('textbox',{name:'Название',exact:true}).fill('Бумага')
  await dialog.getByRole('combobox',{name:'Категория',exact:true}).selectOption('__new__')
  await dialog.getByRole('button',{name:'Добавить категорию',exact:true}).click()
  await expect(dialog.getByRole('alert')).toHaveText('Введите название категории.')
  await dialog.getByRole('textbox',{name:'Название новой категории'}).fill('Тест')
  await page.route('**/api/v1/planned-purchases/categories',route=>route.fulfill({status:500,json:{message:'SQLSTATE should never be visible'}}))
  await dialog.getByRole('button',{name:'Добавить категорию',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('Сервер временно недоступен')
  await expect(dialog.getByRole('textbox',{name:'Название новой категории'})).toHaveValue('Тест')
  await dialog.getByRole('button',{name:'Отмена категории'}).click()
  await expect(dialog.getByRole('textbox',{name:'Название',exact:true})).toHaveValue('Бумага')
  await dialog.getByLabel('Следующая дата',{exact:true}).fill('2026-12-21')
  await page.route('**/api/v1/planned-purchases',route=>route.fulfill({status:422,json:{message:'Проверьте данные покупки.'}}))
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(dialog.getByRole('alert')).toHaveText('Проверьте данные покупки.')
  await expect(dialog.getByRole('textbox',{name:'Название',exact:true})).toHaveValue('Бумага')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('family member chooses shared categories without creating Finance categories',async({page})=>{
  await mockShopping(page)
  await page.route('**/api/v1/me',route=>route.fulfill({json:{data:{family:{id:'f1',role:'USER',visibility:{finance:false,shopping:true,calendar:true}}}}}))
  await page.goto('/?section=lists')
  await page.getByRole('tab',{name:'Крупные',exact:true}).click()
  await page.getByRole('button',{name:'＋ Добавить',exact:true}).click()
  const select=page.getByRole('combobox',{name:'Категория',exact:true})
  await expect(select.locator('option:checked')).toHaveText('Выберите категорию')
  await expect(select.locator('option')).toHaveCount(3)
  await select.selectOption('Для дома')
  await expect(select).toHaveValue('Для дома')
})

 test('recurring quantity and price can be changed and survive reload',async({page})=>{
  await mockShopping(page)
  await page.goto('/?section=lists')
  await page.getByRole('tab',{name:'Регулярные',exact:true}).click()
  await page.getByRole('button',{name:'Изменить покупку: Бумага',exact:true}).click()
  const dialog=page.getByRole('dialog')
  await expect(dialog.getByLabel('Количество, шт.')).toHaveValue('1')
  await expect(dialog.getByLabel('Цена за штуку, ₽')).toHaveValue('350')
  await dialog.getByLabel('Количество, шт.').fill('0')
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Количество, шт.').fill('4')
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await page.getByRole('tab',{name:'Регулярные',exact:true}).click()
  await expect(page.locator('article').filter({hasText:'Бумага'})).toContainText('1 400 ₽')
  await page.getByRole('button',{name:'Изменить покупку: Бумага',exact:true}).click()
  await expect(page.getByLabel('Количество, шт.')).toHaveValue('4')
  await page.getByLabel('Цена за штуку, ₽').fill('')
  await page.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(page.locator('article').filter({hasText:'Бумага'})).toContainText('Сумма не задана')
 })
