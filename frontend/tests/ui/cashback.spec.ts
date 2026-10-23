import { expect,test,type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const entry=(category:string,rate:number,extra:any={})=>({category,rate,reward_unit:'RUB',active:true,cap_amount:null,notes:null,valid_from:null,valid_to:null,...extra})
async function mockCashback(page:Page,finance=true){
  await page.clock.install({time:new Date('2026-10-22T09:00:00Z')})
  const records:any[]=[
    {id:'mine',bank_name:'Т-Банк',bank_key:'тбанк',created_by:'u1',creator:{first_name:'Мария'},month:'2026-10',revision:1,can_edit:true,entries:[entry('Супермаркеты',5),entry('Транспорт',3)]},
    {id:'other',bank_name:'Альфа-Банк',bank_key:'альфабанк',created_by:'u2',creator:{first_name:'Андрей'},month:'2026-10',revision:1,can_edit:false,entries:[entry('Супермаркеты',7),entry('Балльная категория',99,{reward_unit:'POINTS'}),entry('Неактивная',80,{active:false}),entry('Истекла',90,{valid_to:'2026-10-01'}),entry('Позже',90,{valid_from:'2026-10-30'}),entry('Без лимита',90,{cap_amount:0})]},
    {id:'history',bank_name:'Т-Банк',created_by:'u1',creator:{first_name:'Мария'},month:'2026-09',revision:1,can_edit:true,entries:[entry('История сентября',10)]},
  ]
  const calls:{path:string;method:string;body:any}[]=[]
  let failSave=false,failRecognize=false
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1',''),method=req.method(),body=method==='GET'?null:req.postDataJSON()
    calls.push({path,method,body});let data:any=[],meta:any
    if(path==='/me')data={id:'u1',family:{role:'USER',visibility:{finance,calendar:false,shopping:false}}}
    else if(path==='/family')data={timezone:'Europe/Moscow'}
    else if(path==='/finance/analytics')data={total_income:50000,total_expense:10000,balance:40000,ranked:[],trend:[]}
    else if(path==='/finance/categories')data=[{id:'c1',name:'Продукты',transaction_type:'EXPENSE'}]
    else if(path==='/finance/cashback-banks/recognize'){
      if(failRecognize){await route.fulfill({status:503,json:{message:'Распознавание временно недоступно.'}});return}
      data={bank_name:'Т-Банк',entries:[entry('Супермаркеты',6,{active:false,reward_unit:'UNKNOWN'}),entry('Аптеки',8,{active:false,reward_unit:'UNKNOWN'})],message:'Проверьте данные перед сохранением.'}
    }else if(path.startsWith('/finance/cashback-banks')){
      if(method==='GET'){const month=url.searchParams.get('month')||'2026-10';data=records.filter(r=>r.month===month);meta={month,today:'2026-10-22',user_id:'u1'}}
      else{
        if(failSave){await route.fulfill({status:409,json:{message:'Категории уже изменились. Обновите список.'}});return}
        const id=path.split('/').at(-1),index=records.findIndex(r=>r.id===id)
        if(method==='DELETE'){records.splice(index,1);await route.fulfill({status:204});return}
        if(method==='PATCH'){Object.assign(records[index],body,{revision:records[index].revision+1});data=records[index]}
        else{data={id:'created'+records.length,...body,created_by:'u1',creator:{first_name:'Мария'},can_edit:true,revision:1};records.push(data)}
      }
    }
    await route.fulfill({json:{data,...(meta?{meta}:{})}})
  })
  return {records,calls,setFailSave:(v:boolean)=>{failSave=v},setFailRecognize:(v:boolean)=>{failRecognize=v}}
}
const openCashback=async(page:Page)=>{await page.goto('/?section=finance');await page.getByRole('tab',{name:'Кешбэк',exact:true}).click();await expect(page.getByRole('button',{name:'Обновить кешбэк'})).toBeEnabled()}
const fixture={name:'categories.png',mimeType:'image/png',buffer:Buffer.from(readFileSync('../backend/tests/Fixtures/receipt.png.b64','utf8').trim(),'base64')}

for(const width of [320,393,768])test(`cashback comparison and editing fit ${width}px and persist`,async({page})=>{
  const state=await mockCashback(page);await page.setViewportSize({width,height:852});await openCashback(page)
  const filters=await page.locator('.cb-page>.card>.cb-filters>.f-field').evaluateAll(fields=>fields.map(field=>{const bounds=field.getBoundingClientRect(),label=field.querySelector('span')!.getBoundingClientRect(),control=field.querySelector('input,select')!.getBoundingClientRect();return {right:bounds.right,labelRight:label.right,left:control.left,controlRight:control.right}}))
  for(const field of filters){expect(field.labelRight).toBeLessThanOrEqual(field.left);expect(field.controlRight).toBeLessThanOrEqual(field.right)}
  await expect(page.getByRole('table',{name:'Категории кешбэка'})).toContainText('Андрей')
  await page.getByRole('button',{name:'Подробнее: Супермаркеты, Т-Банк, Мария'}).click()
  await page.getByRole('button',{name:'Изменить категории банка'}).click()
  const dialog=page.getByRole('dialog',{name:'Изменить кешбэк банка'})
  await dialog.getByLabel('Кешбэк, %',{exact:true}).first().fill('6.5')
  await dialog.getByLabel('Проверены банк, месяц, проценты и выбранные категории').check()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  const bounds=await dialog.boundingBox();expect(bounds!.width).toBeLessThanOrEqual(width)
  await page.screenshot({path:`test-results/cashback-editor-${width}.png`})
  await dialog.getByRole('button',{name:'Сохранить категории'}).click();await expect(dialog).toHaveCount(0)
  expect(state.records[0].entries[0].rate).toBe(6.5)
  await page.reload();await page.getByRole('tab',{name:'Кешбэк',exact:true}).click();await expect(page.getByRole('table',{name:'Категории кешбэка'})).toContainText('6,5%')
  await page.screenshot({path:`test-results/cashback-table-${width}.png`,fullPage:true})
  expect(state.calls.filter(c=>c.path.includes('/cards'))).toHaveLength(0)
})

for(const surface of ['home','finance'])test(`${surface} cashback percentage header sorts numerically in both directions and retains sorting on owner filter`,async({page})=>{
  const state=await mockCashback(page)
  state.records[0].entries.push(entry('Аптеки',10.5),entry('Кафе',9.25))
  if(surface==='home')await page.goto('/');else await openCashback(page)
  const table=page.getByRole('table',{name:surface==='home'?'Лучшие ставки кешбэка':'Категории кешбэка',exact:true})
  await expect(table).toBeVisible()
  const rates=async()=>(await table.locator('.cb-table-rate b').allTextContents()).map(value=>Number(value.replace('%','').replace(',','.')))
  const header=table.getByRole('columnheader').nth(1)
  await expect(header).toHaveAttribute('aria-sort','none')
  await table.getByRole('button',{name:'Сортировать по проценту кешбэка: сначала больший',exact:true}).click()
  await expect(header).toHaveAttribute('aria-sort','descending')
  expect(await rates()).toEqual(surface==='home'?[99,10.5,9.25,7,3]:[99,10.5,9.25,7,5,3])
  const reverse=table.getByRole('button',{name:'Сортировать по проценту кешбэка: сначала меньший',exact:true})
  await reverse.focus();await page.keyboard.press('Enter')
  await expect(header).toHaveAttribute('aria-sort','ascending')
  expect(await rates()).toEqual(surface==='home'?[3,7,9.25,10.5,99]:[3,5,7,9.25,10.5,99])
  if(surface==='home')await page.getByRole('region',{name:'Где выгоднее кешбэк'}).getByRole('button',{name:'Мои банки',exact:true}).click()
  else await page.getByRole('combobox',{name:/Владелец/}).selectOption('mine')
  await expect(header).toHaveAttribute('aria-sort','ascending')
  expect(await rates()).toEqual([3,5,9.25,10.5])
})

test('home shows all unique current categories; screenshots are imported from Finance',async({page})=>{
  const state=await mockCashback(page);await page.setViewportSize({width:320,height:852});await page.goto('/')
  const summary=page.getByRole('region',{name:'Где выгоднее кешбэк'})
  await expect(summary).toContainText('Альфа-Банк');await expect(summary).toContainText('Андрей');await expect(summary).toContainText('7%')
  await expect(summary.getByRole('columnheader')).toHaveCount(3)
  await summary.scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/cashback-home-table-320.png'})
  for(const absent of ['Неактивная','Истекла','Позже','Без лимита'])await expect(summary).not.toContainText(absent)
  await expect(summary).toContainText('Балльная категория')
  await expect(summary.getByText('Загрузить категории',{exact:true})).toHaveCount(0)
  await summary.getByRole('button',{name:'Мои банки',exact:true}).click();await expect(summary).not.toContainText('Андрей');await expect(summary).toContainText('5%')
  await summary.getByRole('button',{name:'Весь кешбэк →'}).click()
  await page.getByLabel('Загрузить скриншоты кешбэка').setInputFiles([fixture,{...fixture,name:'categories-2.png'}])
  const dialog=page.getByRole('dialog',{name:'Изменить кешбэк банка'})
  await expect(dialog.getByRole('button',{name:'Сохранить категории'})).toBeDisabled()
  await expect(dialog.getByLabel('Категория банка',{exact:true})).toHaveCount(3)
  await expect(dialog.getByLabel('Кешбэк, %',{exact:true}).first()).toHaveValue('6')
  await expect(dialog.getByLabel('Категория выбрана в банке').first()).not.toBeChecked()
  await dialog.getByLabel('Проверены банк, месяц, проценты и выбранные категории').check()
  await dialog.getByRole('button',{name:'Сохранить категории'}).click();await expect(dialog.getByRole('alert')).toContainText('тип вознаграждения')
  const units=dialog.getByRole('combobox',{name:'Вознаграждение',exact:true});await expect(units).toHaveCount(3)
  for(const select of await units.all())await select.selectOption('RUB')
  await dialog.getByLabel('Категория выбрана в банке').first().check()
  await dialog.getByLabel('Проверены банк, месяц, проценты и выбранные категории').check()
  await dialog.getByRole('button',{name:'Сохранить категории'}).click();await expect(dialog).toHaveCount(0)
  expect(state.records.filter(r=>r.month==='2026-10'&&r.created_by==='u1')).toHaveLength(1)
  expect(state.records[0].entries).toHaveLength(3)
  expect(state.calls.filter(c=>c.path.endsWith('/recognize'))).toHaveLength(2)
  await page.getByRole('button',{name:'Главная',exact:true}).click();await expect(page.getByRole('region',{name:'Где выгоднее кешбэк'})).toContainText('7%')
})

test('home cashback has no four-category limit and keeps the highest rate for duplicates',async({page})=>{
  const state=await mockCashback(page)
  for(let i=0;i<7;i++)state.records[0].entries.push(entry('Дополнительная категория '+i,2+i))
  state.records[0].entries.push(entry(' супермаркеты ',4))
  await page.setViewportSize({width:320,height:852});await page.goto('/')
  const table=page.getByRole('table',{name:'Лучшие ставки кешбэка'})
  await expect(table.locator('tbody tr')).toHaveCount(10)
  const duplicate=table.getByRole('row').filter({hasText:/Супермаркеты/i})
  await expect(duplicate).toHaveCount(1);await expect(duplicate).toContainText('7%');await expect(duplicate).toContainText('Андрей')
  await expect(table).toContainText('Дополнительная категория 6')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('manual entry, month archive and deletion preserve another month',async({page})=>{
  const state=await mockCashback(page);await openCashback(page)
  await page.getByRole('button',{name:'＋ Вручную'}).click();const dialog=page.getByRole('dialog',{name:'Добавить кешбэк банка'})
  await dialog.getByLabel('Название банка').fill('Мой новый банк');await dialog.getByLabel('Категория банка',{exact:true}).fill('Дом')
  await dialog.getByLabel('Кешбэк, %',{exact:true}).fill('4');await dialog.getByLabel('Категория выбрана в банке').check();await dialog.getByLabel('Проверены банк, месяц, проценты и выбранные категории').check()
  await dialog.getByRole('button',{name:'Сохранить категории'}).click();await expect(dialog).toHaveCount(0)
  await page.getByRole('button',{name:'Подробнее: Дом, Мой новый банк, Мария'}).click()
  await page.getByRole('button',{name:'Изменить категории банка'}).click()
  await page.getByRole('button',{name:'Удалить за месяц'}).click();await page.getByRole('dialog',{name:'Удалить кешбэк банка?'}).getByRole('button',{name:'Удалить категории',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.records.filter(r=>r.bank_name==='Мой новый банк')).toHaveLength(0)
  await page.getByLabel('Месяц кешбэка').fill('2026-09');await expect(page.getByRole('table',{name:'Категории кешбэка'})).toContainText('История сентября')
  await expect(page.getByRole('table',{name:'Категории кешбэка'})).not.toContainText('Супермаркеты')
})

test('recognition and save errors retain the editable draft',async({page})=>{
  const state=await mockCashback(page);state.setFailRecognize(true);await openCashback(page)
  await page.getByLabel('Загрузить скриншоты кешбэка').setInputFiles(fixture)
  const dialog=page.getByRole('dialog',{name:'Добавить кешбэк банка'})
  await expect(dialog.getByRole('alert')).toContainText('временно недоступен')
  await dialog.getByLabel('Название банка').fill('Тестовый банк');await dialog.getByLabel('Категория банка',{exact:true}).fill('Кафе');await dialog.getByLabel('Кешбэк, %',{exact:true}).fill('4')
  await dialog.getByLabel('Проверены банк, месяц, проценты и выбранные категории').check();state.setFailSave(true)
  await dialog.getByRole('button',{name:'Сохранить категории'}).click();await expect(dialog.getByRole('alert')).toContainText('уже изменились')
  await expect(dialog.getByLabel('Категория банка',{exact:true})).toHaveValue('Кафе')
  state.setFailSave(false);await dialog.getByRole('button',{name:'Сохранить категории'}).click();await expect(dialog).toHaveCount(0)
})

test('finance visibility also hides cashback summary and prevents fetching it',async({page})=>{
  const state=await mockCashback(page,false);await page.goto('/')
  await expect(page.getByRole('button',{name:'Семья',exact:true})).toBeVisible()
  await expect(page.getByRole('region',{name:'Где выгоднее кешбэк'})).toHaveCount(0)
  expect(state.calls.some(c=>c.path.includes('cashback-banks'))).toBe(false)
})

test('three-column table compares banks and opens conditions without mixing inactive rates',async({page})=>{
  await mockCashback(page);await page.setViewportSize({width:320,height:640});await openCashback(page)
  const table=page.getByRole('table',{name:'Категории кешбэка'})
  await expect(table.getByRole('columnheader')).toHaveText(['Категория / банк','Кешбэк','Владелец'])
  await expect(table.getByRole('row').filter({hasText:'Супермаркеты'})).toHaveCount(2)
  await expect(table).not.toContainText('Неактивная')
  await table.getByRole('button',{name:'Подробнее: Супермаркеты, Альфа-Банк, Андрей'}).click()
  const details=page.getByRole('dialog',{name:'Условия кешбэка'})
  await expect(details).toContainText('7%');await expect(details.getByRole('button',{name:'Изменить категории банка'})).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Все',exact:true}).click()
  const inactive=table.getByRole('row').filter({hasText:'Неактивная'})
  await expect(inactive).toBeVisible();await expect(inactive.locator('.cb-table-best')).toHaveCount(0)
  await page.getByLabel('Поиск кешбэка').fill('супермаркеты')
  await expect(table.getByRole('row')).toHaveCount(3)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
