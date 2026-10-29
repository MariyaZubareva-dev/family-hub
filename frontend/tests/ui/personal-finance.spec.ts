import { expect, test, type Page } from '@playwright/test'
async function setup(page:Page) {
  const pots:any[]=[{id:'p1',name:'Отпуск',balance:20000,target_amount:100000,target_date:null,archived_at:null}],income:any[]=[]
  const history:any[]=[],requests:any[]=[]
  let available=80000,fail=false
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1',''),method=req.method(),body=method==='GET'?null:req.postDataJSON()
    if(body)requests.push({path,body});let data:any=[]
    if(path==='/me')data={id:'u1',family:{id:'f1',role:'USER',visibility:{finance:true,shopping:true,calendar:true}}}
    else if(path==='/finance/categories')data=[{id:'c1',name:'ЗП',transaction_type:'INCOME'}]
    else if(path==='/finance/analytics')data={total_income:100000,total_expense:0,balance:100000,available_cash:available,ranked:[],trend:[]}
    else if(path==='/finances'&&method==='GET')data=income
    else if(path==='/finances'&&method==='POST'){data={id:'t1',...body};income.push(data);available+=body.amount;if(body.savings_pot_id){pots[0].balance+=body.savings_amount;available-=body.savings_amount}}
    else if(path==='/finances/t1'){data=income[0];available+=body.amount-data.amount;Object.assign(data,body)}
    else if(path==='/finance/personal')data={pots,history,income,available}
    else if(path==='/finance/pots'&&method==='POST'){pots.push({id:'p2',...body,balance:body.opening_amount,archived_at:null});data={pots}}
    else if(path.endsWith('/movements')){
      if(fail){fail=false;await route.fulfill({status:422,json:{message:'В семейном бюджете недостаточно доступных денег.'}});return}
      const pot=pots.find(p=>path.includes('/'+p.id+'/'))
      if(body.kind==='DEPOSIT'){pot.balance+=body.amount;available-=body.amount}else if(body.kind==='WITHDRAW'){pot.balance-=body.amount;available+=body.amount}else{pot.balance-=body.amount;pots.find(p=>p.id===body.destination_id).balance+=body.amount}
      history.unshift({id:'h'+history.length,pot_id:pot.id,...body,created_at:'2026-10-29T12:00:00Z'})
    }else if(path.endsWith('/archive'))pots.find(p=>path.includes('/'+p.id+'/')).archived_at='2026-10-29'
    await route.fulfill({json:{data}})
  })
  await page.goto('/?section=finance')
  await page.getByRole('button',{name:'Мои',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Мои накопления'})).toBeVisible()
  return {requests,pots,failNext:()=>{fail=true}}
}
test('withdrawal updates current family money and survives reload',async({page})=>{
  const s=await setup(page)
  await page.getByRole('button',{name:'Вернуть в бюджет',exact:true}).click()
  await page.getByRole('spinbutton',{name:'Сумма, ₽',exact:true}).fill('5000')
  await page.getByRole('button',{name:'Перевести',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('region',{name:'Копилка Отпуск'})).toContainText('15 000 ₽')
  await page.getByRole('button',{name:'Семейные',exact:true}).click()
  await expect(page.locator('.f-current-cash')).toContainText('85 000 ₽')
  await page.reload();await expect(page.locator('.f-current-cash')).toContainText('85 000 ₽')
  expect(s.requests.filter(r=>r.path==='/finances')).toHaveLength(0)
  await expect(page.getByRole('tab',{name:'Запасы'})).toHaveCount(0)
})
test('income reservation and editing preserve saved transfers',async({page})=>{
  const s=await setup(page)
  await page.getByRole('button',{name:'Мои доходы',exact:true}).click()
  await page.getByRole('button',{name:'+ Доход'}).click()
  await page.getByRole('spinbutton',{name:'Сумма, ₽'}).fill('50000')
  await page.getByRole('combobox',{name:'Категория',exact:true}).selectOption('c1')
  await page.getByRole('combobox',{name:'Отложить в копилку'}).selectOption('p1')
  await page.getByRole('spinbutton',{name:'Отложить, ₽',exact:true}).fill('10000')
  await page.getByRole('button',{name:'Сохранить доход'}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(s.requests.find(r=>r.path==='/finances').body).toMatchObject({amount:50000,savings_amount:10000,savings_pot_id:'p1'})
  await page.getByRole('button',{name:'Редактировать доход ЗП'}).click()
  await page.getByRole('spinbutton',{name:'Сумма, ₽'}).fill('40000')
  await expect(page.getByRole('dialog')).toContainText('Ранее сделанные переводы в копилки сохранятся')
  await page.getByRole('button',{name:'Сохранить доход'}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(s.pots[0].balance).toBe(30000)
})
test('failed transfer stays editable with stable retry key and mobile layout fits',async({page})=>{
  const s=await setup(page)
  for(const width of [320,393,768]){await page.setViewportSize({width,height:852});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/personal-savings-${width}.png`,fullPage:true})}
  s.failNext()
  await page.getByRole('button',{name:'Пополнить',exact:true}).click()
  await page.getByRole('spinbutton',{name:'Сумма, ₽'}).fill('10')
  await page.getByRole('button',{name:'Перевести',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('недостаточно')
  await expect(page.getByRole('spinbutton',{name:'Сумма, ₽'})).toHaveValue('10')
  await page.getByRole('button',{name:'Перевести',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const moves=s.requests.filter(r=>r.path.endsWith('/movements'));expect(moves[0].body.request_key).toBe(moves[1].body.request_key)
})
test('opening savings stay outside family money and closing requires empty pot',async({page})=>{
  await setup(page)
  await page.getByRole('button',{name:'+ Копилка'}).click()
  await page.getByRole('textbox',{name:'Название',exact:true}).fill('Подушка')
  await page.getByRole('spinbutton',{name:'Уже накоплено, ₽'}).fill('1000')
  await page.getByRole('button',{name:'Сохранить копилку'}).click()
  const card=page.getByRole('region',{name:'Копилка Подушка'})
  await expect(card).toContainText('1 000 ₽')
  await card.getByRole('button',{name:'Закрыть копилку'}).click()
  await expect(page.getByRole('dialog')).toContainText('Сначала верните')
  await page.getByRole('button',{name:'Закрыть',exact:true}).click()
  await card.getByRole('button',{name:'В другую копилку'}).click()
  await page.getByRole('combobox',{name:'Куда перевести'}).selectOption('p1')
  await page.getByRole('spinbutton',{name:'Сумма, ₽'}).fill('1000')
  await page.getByRole('button',{name:'Перевести',exact:true}).click()
  await expect(card).toContainText('0 ₽')
  await card.getByRole('button',{name:'Закрыть копилку'}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Закрыть копилку',exact:true}).click()
  await expect(card).toHaveCount(0)
  await page.getByRole('button',{name:'Семейные',exact:true}).click()
  await expect(page.locator('.f-current-cash')).toContainText('80 000 ₽')
})
