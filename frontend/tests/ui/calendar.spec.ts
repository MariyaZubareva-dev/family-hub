import { wallTimeToDate, zoneInput } from '../../src/lib/timezone'
import { expect, test, type Page } from '@playwright/test'

async function mockCalendar(page:Page,omitCreatedStatus=false){
  await page.clock.install({time:new Date('2026-10-21T09:00:00Z')})
  const members=[{id:'m1',user:{first_name:'Мария'}},{id:'m2',user:{first_name:'Оченьдлинноеимяучастникасемьи'}}]
  const events:any[]=[{id:'e1',title:'Длинное название семейного события для проверки на узком экране',description:'Подробности встречи',status:'SCHEDULED',start_at:'2026-10-21T12:00:00Z',responsible_member:members[1]},{id:'e2',title:'Другое событие',status:'SCHEDULED',start_at:'2026-10-22T12:00:00Z'}]
  const reminders:any[]=[{id:'r1',title:'Напоминание о заказе',status:'SCHEDULED',scheduled_at:'2026-10-21T14:00:00Z'}]
  const requests:{path:string;body:any}[]=[]
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname
    let data:any=[]
    if(path.endsWith('/me'))data={family:{id:'f1',role:'ADMIN',visibility:{finance:true,shopping:true,calendar:true}}}
    else if(path.endsWith('/family'))data={members,current_member_id:'m1'}
    else if(path.endsWith('/events')||path.endsWith('/reminders')){
      const list=path.endsWith('/events')?events:reminders
      if(req.method()==='POST'){const body=req.postDataJSON();requests.push({path,body});data={...body,id:'new'+list.length,status:'SCHEDULED',responsible_member:members.find(x=>x.id===body.responsible_member_id)};list.push(data);if(omitCreatedStatus){data={...data};delete data.status}}else data=list
    }
    await route.fulfill({json:{data}})
  })
  return requests
}
for(const width of [320,393,768]){
  test(`calendar and action forms fit ${width}px and save events and reminders`,async({page})=>{
    await page.setViewportSize({width,height:852})
    const requests=await mockCalendar(page,true)
    await page.goto('/?section=calendar')
    await expect(page.getByRole('heading',{name:'Планы на месяц 3'})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const grid=page.getByRole('group',{name:'Выбор даты'})
    await expect(grid.getByRole('button')).toHaveCount(7)
    expect((await page.locator('.c-month').boundingBox())!.height).toBeLessThan(240)
    await page.getByRole('button',{name:'Показать месяц',exact:true}).click()
    await expect(grid.getByRole('button')).toHaveCount(31)
    expect((await grid.boundingBox())!.height).toBeLessThan(260)
    const day=grid.getByRole('button',{name:'21 октября 2026, планов: 2',exact:true})
    await day.focus();await page.keyboard.press('Enter')
    await expect(day).toHaveAttribute('aria-pressed','true')
    await expect(page.getByRole('heading',{name:'Планы на 21 октября 2'})).toBeVisible()
    await expect(page.getByText('Другое событие',{exact:true})).toHaveCount(0)
    await page.getByText('Описание',{exact:true}).click()
    await expect(page.getByText('Подробности встречи',{exact:true})).toBeVisible()
    await page.screenshot({path:`test-results/calendar-day-${width}.png`,fullPage:true})
    await page.getByRole('button',{name:'Весь месяц',exact:true}).click()
    await expect(page.getByText('Другое событие',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Следующий месяц'}).click()
    await expect(page.getByRole('heading',{name:'ноябрь 2026 г.'})).toBeVisible()
    await expect(page.getByText('В этом месяце планов пока нет.')).toBeVisible()
    await page.getByRole('button',{name:'Сегодня',exact:true}).click()
    await expect(day).toHaveAttribute('aria-current','date')
    await page.getByRole('button',{name:'＋ Встреча',exact:true}).click()
    const event=page.getByRole('dialog',{name:'Новая встреча',exact:true})
    await expect(event.getByRole('textbox',{name:'Название',exact:true})).toBeFocused()
    await event.getByRole('textbox',{name:'Название',exact:true}).fill('Встреча семьи')
    await event.getByLabel('Дата',{exact:true}).fill('2026-10-23')
    await event.getByLabel('Время',{exact:true}).fill('16:30')
    await event.getByRole('checkbox',{name:'Оченьдлинноеимяучастникасемьи',exact:true}).check()
    await expect(event.getByRole('checkbox',{name:'Мария',exact:true})).toBeChecked()
    await event.getByRole('textbox',{name:'Описание',exact:true}).fill('Обсудить планы')
    await page.screenshot({path:`test-results/calendar-event-form-${width}.png`,fullPage:true})
    expect((await event.boundingBox())!.width).toBeLessThanOrEqual(Math.min(width,420))
    expect(await event.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
    await event.getByRole('button',{name:'Сохранить',exact:true}).click()
    await expect(event).toHaveCount(0)
    expect(requests[0]).toMatchObject({path:'/api/v1/events',body:{title:'Встреча семьи',responsible_member_ids:['m1','m2'],participant_member_ids:['m1','m2'],timezone:'Europe/Moscow',start_at:'2026-10-23T13:30:00.000Z',end_at:'2026-10-23T14:30:00.000Z'}})
    await expect(page.getByText('Встреча семьи',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'＋ Напоминание',exact:true}).click()
    const reminder=page.getByRole('dialog',{name:'Новое напоминание',exact:true})
    await reminder.getByRole('textbox',{name:'Название',exact:true}).fill('Забрать заказ')
    await reminder.getByLabel('Дата',{exact:true}).fill('2026-10-24')
    await reminder.getByLabel('Время',{exact:true}).fill('10:00')
    await page.screenshot({path:`test-results/calendar-reminder-form-${width}.png`,fullPage:true})
    await reminder.getByRole('button',{name:'Сохранить',exact:true}).click()
    await expect(reminder).toHaveCount(0)
    expect(requests[1]).toMatchObject({path:'/api/v1/reminders',body:{title:'Забрать заказ',responsible_member_ids:['m1','m2'],timezone:'Europe/Moscow',scheduled_at:'2026-10-24T07:00:00.000Z'}})
    await expect(page.getByText('Забрать заказ',{exact:true})).toBeVisible()
    await page.getByRole('tab',{name:/^Встречи/}).click()
    await expect(page.getByText('Забрать заказ',{exact:true})).toHaveCount(0)
    await page.getByRole('tab',{name:/^Напоминания/}).click()
    await expect(page.getByText('Забрать заказ',{exact:true})).toBeVisible()
    await page.reload()
    await expect(page.getByText('Встреча семьи',{exact:true})).toBeVisible()
    await expect(page.getByText('Забрать заказ',{exact:true})).toBeVisible()
    await page.screenshot({path:`test-results/calendar-month-${width}.png`,fullPage:true})
  })
}

test('calendar save errors retain the draft; short modal scrolls and restores focus',async({page})=>{
  await page.setViewportSize({width:320,height:480})
  await mockCalendar(page)
  await page.goto('/?section=calendar')
  const trigger=page.getByRole('button',{name:'＋ Встреча',exact:true})
  await trigger.click()
  const dialog=page.getByRole('dialog',{name:'Новая встреча',exact:true})
  await dialog.getByRole('textbox',{name:'Название',exact:true}).fill('Не потерять черновик')
  await dialog.getByRole('checkbox',{name:'Мария',exact:true}).uncheck()
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('хотя бы одного ответственного')
  await dialog.getByRole('checkbox',{name:'Мария',exact:true}).check()
  await page.route('**/api/v1/events',route=>route.fulfill({status:500,json:{message:'SQLSTATE private detail'}}))
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(dialog.getByRole('alert')).toHaveText('Сервер временно недоступен. Попробуйте ещё раз позже.')
  await expect(dialog.getByRole('textbox',{name:'Название',exact:true})).toHaveValue('Не потерять черновик')
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).scrollIntoViewIfNeeded()
  await expect(dialog.getByRole('button',{name:'Сохранить',exact:true})).toBeInViewport()
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await page.getByRole('button',{name:'О календаре',exact:true}).click()
  await expect(page.getByRole('tooltip')).toContainText('Встреча создаётся на один час')
})

test.describe('Calendar on a device in another timezone',()=>{
test.use({timezoneId:'America/Los_Angeles'})
test('family timezone controls calendar input across device zones and DST',async({page})=>{
  const requests=await mockCalendar(page)
  await page.route('**/api/v1/family',route=>route.fulfill({json:{data:{timezone:'Asia/Yekaterinburg',current_member_id:'m1',members:[{id:'m1',user:{first_name:'Мария'}}]}}}))
  await page.goto('/?section=calendar')
  await page.getByRole('button',{name:'＋ Напоминание',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Новое напоминание'})
  await dialog.getByRole('textbox',{name:'Название',exact:true}).fill('По времени семьи')
  await dialog.getByLabel('Дата',{exact:true}).fill('2026-10-21')
  await dialog.getByLabel('Время',{exact:true}).fill('19:22')
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
  expect(requests[0].body).toMatchObject({scheduled_at:'2026-10-21T14:22:00.000Z',timezone:'Asia/Yekaterinburg'})
  await expect(page.getByRole('status')).toContainText('19:22')
  await expect(page.getByText('По времени семьи',{exact:true})).toBeVisible()
  expect(zoneInput(wallTimeToDate('2026-12-01T19:22','Europe/Warsaw'),'Europe/Warsaw')).toBe('2026-12-01T19:22')
  expect(()=>wallTimeToDate('2026-03-29T02:30','Europe/Warsaw')).toThrow('такого времени нет')
})

})
