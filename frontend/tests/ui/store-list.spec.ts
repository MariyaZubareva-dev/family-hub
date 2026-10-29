import { expect,test,type Page } from '@playwright/test'

async function mockStore(page:Page){
  const items:any[]=[{id:'auto1',name:'Шампунь',quantity:null,notes:null,is_completed:false,recurring_purchase_id:'p1',recurring_due_date:'2026-10-22'}]
  const writes:{method:string;body:any}[]=[]
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,method=req.method()
    let data:any=[]
    if(path.endsWith('/me'))data={family:{id:'f1',role:'USER',visibility:{shopping:true,finance:true,calendar:true}}}
    else if(path.endsWith('/planned-purchases/categories'))data=[{id:'c1',name:'Продукты'}]
    else if(path.includes('/planned-purchases/store-items')){
      if(method==='GET')data=items
      else{
        const body=method==='DELETE'?null:req.postDataJSON();writes.push({method,body})
        if(method==='POST'){data={id:'manual'+items.length,is_completed:false,...body};items.push(data)}
        else{const index=items.findIndex(i=>path.endsWith('/'+i.id));if(method==='DELETE'){items.splice(index,1);data=null}else{Object.assign(items[index],body);data=items[index]}}
      }
    }
    await route.fulfill({json:{data}})
  })
  return {items,writes}
}

for(const width of [320,393,768])test(`store list edits, checkboxes, undo and removal persist at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:852})
  const state=await mockStore(page)
  await page.goto('/?section=lists');await expect(page.getByRole('tab',{name:'Магазин',exact:true})).toHaveAttribute('aria-selected','true')
  await expect(page.getByText('Из регулярных покупок',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'＋ Добавить',exact:true}).click()
  let dialog=page.getByRole('dialog',{name:'Добавить товар',exact:true})
  await dialog.getByLabel('Название',{exact:true}).fill('Очень длинное название товара для поездки в магазин')
  await dialog.getByLabel('Количество',{exact:true}).fill('2 упаковки')
  await dialog.getByLabel('Заметка').fill('Без сахара')
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  expect(state.items).toHaveLength(2)
  await page.getByRole('button',{name:'Изменить товар: Очень длинное название товара для поездки в магазин',exact:true}).click()
  dialog=page.getByRole('dialog',{name:'Изменить товар',exact:true})
  await expect(dialog.getByLabel('Количество',{exact:true})).toHaveValue('2 упаковки')
  await dialog.getByLabel('Название',{exact:true}).fill('Молоко')
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
  await page.getByRole('checkbox',{name:'Куплено: Молоко',exact:true}).click()
  await expect(page.getByText('Куплено (1)',{exact:true})).toBeVisible()
  await page.getByText('Куплено (1)',{exact:true}).click()
  await expect(page.getByRole('checkbox',{name:'Куплено: Молоко',exact:true})).toBeChecked()
  await page.getByRole('checkbox',{name:'Куплено: Молоко',exact:true}).click()
  await expect(page.getByRole('checkbox',{name:'Куплено: Молоко',exact:true})).not.toBeChecked()
  await page.reload();await page.getByRole('tab',{name:'Магазин',exact:true}).click()
  await expect(page.getByText('Без сахара',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`test-results/store-list-${width}.png`,fullPage:true})
  await page.getByRole('button',{name:'Изменить товар: Молоко',exact:true}).click()
  await page.getByRole('dialog',{name:'Изменить товар',exact:true}).getByRole('button',{name:'Удалить товар',exact:true}).click()
  await page.getByRole('dialog',{name:'Удалить товар?',exact:true}).getByRole('button',{name:'Удалить товар',exact:true}).click()
  await expect(page.getByRole('checkbox',{name:'Куплено: Молоко',exact:true})).toHaveCount(0)
  expect(state.items).toHaveLength(1)
})

test('store list errors preserve draft and checkbox state; polling discovers new due items',async({page})=>{
  await page.clock.install()
  const state=await mockStore(page)
  await page.goto('/?section=lists');await expect(page.getByRole('tab',{name:'Магазин',exact:true})).toHaveAttribute('aria-selected','true')
  await expect(page.getByRole('checkbox',{name:'Куплено: Шампунь',exact:true})).toBeVisible()
  state.items.push({id:'auto2',name:'Бумага',is_completed:false,recurring_purchase_id:'p2'})
  await page.clock.runFor(31000)
  await expect(page.getByRole('checkbox',{name:'Куплено: Бумага',exact:true})).toBeVisible()
  state.items.push({id:'manual-extra',name:'Салфетки',is_completed:false})
  await page.getByRole('button',{name:'Обновить покупки',exact:true}).click()
  await expect(page.getByRole('checkbox',{name:'Куплено: Салфетки',exact:true})).toBeVisible()
  await page.route('**/api/v1/planned-purchases/store-items/**',route=>route.fulfill({status:500,json:{message:'SQLSTATE should not be visible'}}))
  await page.getByRole('checkbox',{name:'Куплено: Бумага',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('Сервер временно недоступен')
  await expect(page.getByRole('checkbox',{name:'Куплено: Бумага',exact:true})).not.toBeChecked()
  await page.getByRole('button',{name:'＋ Добавить',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Добавить товар',exact:true})
  await dialog.getByLabel('Название',{exact:true}).fill('Хлеб')
  await page.route('**/api/v1/planned-purchases/store-items',route=>route.fulfill({status:422,json:{message:'Проверьте название товара.'}}))
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(dialog.getByRole('alert')).toHaveText('Проверьте название товара.')
  await expect(dialog.getByLabel('Название',{exact:true})).toHaveValue('Хлеб')
})
