import { expect, test, type Page } from '@playwright/test'

const full = { calendar: true, shopping: true, finance: true }
function fixture() {
  return { id: 'f1', name: 'Наша семья', my_role: 'ADMIN', current_member_id: 'm1', my_visibility: { ...full }, members: [
    { id: 'm1', role: 'ADMIN', visibility: { ...full }, user: { first_name: 'Мария', username: 'zubareva_life' } },
    { id: 'm2', role: 'USER', visibility: { ...full }, user: { first_name: 'Андрей', username: 'atomrus1993' } },
    { id: 'm3', role: 'USER', visibility: { ...full }, user: { first_name: 'Оченьдлинноеимяучастникасемьи', username: 'a_very_long_telegram_username_123456789' } },
  ] }
}
async function mockApi(page: Page, family = fixture()) {
  const requests: { path: string; body: any }[] = []
  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let data: any = []
    if (path.endsWith('/me')) data = { family: { id: family.id, role: family.my_role, visibility: family.my_visibility } }
    else if (path.endsWith('/family/invitations')) {
      if (request.method() === 'POST') { requests.push({ path, body: request.postDataJSON() }); data = request.postDataJSON() }
      else data = []
    }
    else if (path.endsWith('/family/members/m2') && request.method() === 'PATCH') {
      const body = request.postDataJSON(); requests.push({ path, body }); family.members[1].role = body.role; data = family
    }
    else if (path.endsWith('/family/members/m2') && request.method() === 'DELETE') {
      requests.push({ path, body: null }); family.members = family.members.filter(m => m.id !== 'm2'); data = family
    }
    else if (path.endsWith('/family')) data = family
    else if (path.endsWith('/visibility') && request.method() === 'PATCH') {
      const body = request.postDataJSON()
      requests.push({ path, body })
      const member = family.members.find(m => path.includes(`/${m.id}/`))!
      Object.assign(member.visibility, body.visibility)
      data = family
    }
    await route.fulfill({ json: { data } })
  })
  return requests
}

for (const width of [320, 393, 768]) {
  test(`compact family fits ${width}px with roles next to names`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 })
    await mockApi(page)
    await page.goto('/?section=family')
    await expect(page.getByRole('heading', { name: 'Участники 3' })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByText('Семейный кабинет', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Семейное пространство', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Family Hub', exact: true })).toHaveCount(1)
    const measurements = await page.evaluate(() => {
      const row = document.querySelector('.family-member-name-row')!
      const name = row.querySelector('strong')!.getBoundingClientRect()
      const role = row.querySelector('.family-role')!.getBoundingClientRect()
      const members = document.querySelector('.family-members-card')!.getBoundingClientRect()
      return { width: innerWidth, scroll: document.documentElement.scrollWidth, roleX: role.left, nameRight: name.right, roleY: role.top, nameY: name.top, membersHeight: members.height }
    })
    expect(measurements.scroll).toBeLessThanOrEqual(measurements.width)
    expect(measurements.roleX).toBeGreaterThanOrEqual(measurements.nameRight)
    expect(Math.abs(measurements.roleY - measurements.nameY)).toBeLessThan(8)
    expect(measurements.membersHeight).toBeLessThan(280)
    await expect(page.getByRole('heading', { name: 'Общий доступ', exact: true })).toBeInViewport()
    const trigger = page.getByLabel('Действия участника: Андрей', { exact: true })
    const before = await trigger.boundingBox()
    await trigger.click()
    const after = await trigger.boundingBox()
    expect(after!.y).toBeCloseTo(before!.y, 0)
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('combobox', { name: 'Роль', exact: true })).toBeVisible()
    const inside = await page.evaluate(() => {
      const menu = document.querySelector('.family-member-actions')!.getBoundingClientRect()
      const card = document.querySelector('.family-members-card')!.getBoundingClientRect()
      return menu.bottom <= card.bottom && menu.right <= card.right && menu.left >= card.left && menu.height <= 60
    })
    expect(inside).toBe(true)
    await page.screenshot({ path: `test-results/family-actions-${width}.png`, fullPage: true })
    await trigger.click()
    await expect(page.getByRole('combobox', { name: 'Роль', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '＋ Пригласить', exact: true }).click()
    const invite = page.locator('.family-invite-form')
    await expect(invite.getByRole('textbox', { name: /Telegram ID/ })).toBeVisible()
    await expect(invite.getByRole('textbox', { name: 'Имя (необязательно)' })).toBeVisible()
    const formBounds = await invite.boundingBox()
    expect(formBounds!.height).toBeLessThanOrEqual(155)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await invite.getByRole('textbox', { name: /Telegram ID/ }).fill('@andrey')
    await invite.getByRole('textbox', { name: 'Имя (необязательно)' }).fill('Андрей')
    await page.screenshot({ path: `test-results/family-invite-${width}.png`, fullPage: true })
  })
}

test('admin changes visibility for a member; admin toggle stays locked', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  const requests = await mockApi(page)
  await page.goto('/?section=family')
  await page.getByRole('button', { name: 'Настроить видимость: Бюджет и кредиты' }).click()
  const dialog = page.getByRole('dialog', { name: 'Бюджет и кредиты' })
  await expect(dialog).toBeVisible()
  const admin = dialog.getByRole('switch', { name: 'Мария: Бюджет и кредиты' })
  await expect(admin).toBeChecked()
  await expect(admin).toBeDisabled()
  const member = dialog.getByRole('switch', { name: 'Андрей: Бюджет и кредиты' })
  await member.click()
  await expect(member).not.toBeChecked()
  expect(requests).toEqual([{ path: '/api/v1/family/members/m2/visibility', body: { visibility: { finance: false } } }])
  await page.screenshot({ path: 'test-results/family-visibility-393.png', fullPage: true })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Настроить видимость: Бюджет и кредиты' })).toBeFocused()
})

test('restricted sections are absent from navigation and overview', async ({ page }) => {
  const family = fixture()
  family.my_role = 'USER'
  family.current_member_id = 'm2'
  family.my_visibility = { calendar: false, shopping: true, finance: false }
  await mockApi(page, family)
  await page.goto('/?section=finance')
  await expect(page.getByRole('heading', { name: 'Семья', exact: true })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Основная навигация' })
  await expect(nav.getByRole('button', { name: 'Финансы' })).toHaveCount(0)
  await expect(nav.getByRole('button', { name: 'Календарь' })).toHaveCount(0)
  await expect(nav.getByRole('button', { name: 'Покупки' })).toBeVisible()
  await nav.getByRole('button', { name: 'Главная' }).click()
  await expect(page.getByRole('heading', { name: 'Бюджет за месяц' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'События и напоминания' })).toHaveCount(0)
})

for (const width of [320, 393]) {
  test(`family styled controls save invitations, roles and removal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 })
    const requests = await mockApi(page)
    await page.goto('/?section=family')
    await page.getByRole('button', { name: '＋ Пригласить', exact: true }).click()
    const invite = page.locator('.family-invite-form')
    await invite.getByRole('textbox', { name: /Telegram ID/ }).fill('@new_member')
    await invite.getByRole('textbox', { name: 'Имя (необязательно)' }).fill('Новый участник')
    expect(await invite.locator('input').first().evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px')
    await invite.getByRole('button', { name: 'Создать приглашение' }).click()
    await expect(invite).toHaveCount(0)
    expect(requests[0]).toEqual({ path: '/api/v1/family/invitations', body: { username: 'new_member', first_name: 'Новый участник' } })
    await page.getByLabel('Действия участника: Андрей', { exact: true }).click()
    await page.getByRole('combobox', { name: 'Роль', exact: true }).selectOption('ADMIN')
    await expect(page.locator('.family-member').filter({ hasText: 'Андрей' }).locator('.family-role')).toHaveText('Админ')
    expect(requests[1]).toEqual({ path: '/api/v1/family/members/m2', body: { role: 'ADMIN' } })
    await page.getByLabel('Удалить из семьи', { exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Удалить участника?' })
    await expect(confirmation).toBeVisible()
    expect((await confirmation.boundingBox())!.width).toBeLessThanOrEqual(Math.min(width, 420))
    await page.screenshot({ path: `test-results/family-confirm-${width}.png`, fullPage: true })
    await confirmation.getByRole('button', { name: 'Удалить участника', exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Участники 2' })).toBeVisible()
    expect(requests[2]).toEqual({ path: '/api/v1/family/members/m2', body: null })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}
