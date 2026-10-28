import { expect, test, type Page } from '@playwright/test'
async function setup(page: Page, options: { invited?: boolean; existing?: boolean; failCreate?: boolean } = {}) {
  let member = !!options.existing, failed = false
  const writes: string[] = []
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method()
    let data: any = []
    if (method === 'POST') writes.push(path)
    if (path.endsWith('/me')) data = { family: member ? { id: 'f1', role: 'ADMIN', visibility: { calendar: true, shopping: true, finance: true } } : null }
    else if (path.endsWith('/family/invitations')) data = options.invited && !member ? [{ id: 'i1', status: 'PENDING', family: { name: 'Семья Петровых' }, inviter: { first_name: 'Анна' } }] : []
    else if (path.endsWith('/accept')) { member = true; data = {} }
    else if (path.endsWith('/families')) {
      if (options.failCreate && !failed) { failed = true; await route.fulfill({ status: 503, json: { message: 'Сервер временно недоступен.' } }); return }
      member = true; data = { id: 'f1', name: 'Моя семья' }
    }
    else if (path.endsWith('/family')) data = { id: 'f1', name: 'Моя семья', my_role: 'ADMIN', current_member_id: 'm1', members: [{ id: 'm1', role: 'ADMIN', user: { first_name: 'Мария' } }] }
    else if (path.endsWith('/store-items') && method === 'POST') data = { id: 's1', ...route.request().postDataJSON(), is_completed: false }
    else if (path.includes('/analytics')) data = { total_expense: 0, total_income: 0, ranked: [], trend: [] }
    await route.fulfill({ json: { data } })
  })
  return writes
}
for (const width of [320, 393, 768]) {
  test(`welcome fits ${width}px without writing demo data`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 })
    const writes = await setup(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Меньше забот/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Начать пользоваться', exact: true })).toBeInViewport()
    await expect(page.getByRole('navigation')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    expect(writes).toEqual([])
    await page.screenshot({ path: `test-results/welcome-${width}.png`, fullPage: true })
  })
}
async function choose(page: Page, name: RegExp) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Начать пользоваться', exact: true }).click()
  await page.getByRole('button', { name }).click()
}
test('first shopping item is saved before invitation prompt', async ({ page }) => {
  const writes = await setup(page)
  await choose(page, /Составить список покупок/)
  await expect(page.getByLabel('Название семьи', { exact: true })).toHaveValue('Моя семья')
  await page.getByRole('button', { name: 'Создать семью и продолжить' }).click()
  const dialog = page.getByRole('dialog', { name: 'Добавить товар' })
  await expect(dialog).toBeVisible()
  await expect(page.getByText('Первая запись сохранена')).toHaveCount(0)
  await dialog.getByLabel('Название', { exact: true }).fill('Молоко')
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Первая запись сохранена')).toBeVisible()
  expect(writes.filter(x => x.endsWith('/families'))).toHaveLength(1)
  await page.getByRole('button', { name: 'Пригласить близкого', exact: true }).click()
  await expect(page.getByRole('textbox', { name: /Telegram ID/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('navigation')).toBeVisible()
  await expect(page.locator('.welcome')).toHaveCount(0)
})
test('invited user joins without creating family', async ({ page }) => {
  const writes = await setup(page, { invited: true })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Вас ждут в семье' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Семья Петровых' })).toBeVisible()
  await page.getByRole('button', { name: 'Принять приглашение' }).click()
  await expect(page.getByRole('navigation')).toBeVisible()
  expect(writes).toEqual(['/api/v1/family/invitations/i1/accept'])
})
test('creation failure preserves input and retry opens calendar', async ({ page }) => {
  await setup(page, { failCreate: true })
  await choose(page, /Добавить событие/)
  await page.getByLabel('Название семьи', { exact: true }).fill('Наша семья')
  await page.getByRole('button', { name: 'Создать семью и продолжить' }).click()
  await expect(page.getByRole('alert')).toContainText('Сервер временно недоступен.')
  await expect(page.getByLabel('Название семьи', { exact: true })).toHaveValue('Наша семья')
  await page.getByRole('button', { name: 'Создать семью и продолжить' }).click()
  await expect(page.getByRole('dialog', { name: 'Новая встреча' })).toBeVisible()
})
test('existing family bypasses welcome', async ({ page }) => {
  await setup(page, { existing: true })
  await page.goto('/?section=family')
  await expect(page.getByRole('heading', { name: 'Моя семья' })).toBeVisible()
  await expect(page.locator('.welcome')).toHaveCount(0)
})
test('missing invitation gives recovery path', async ({ page }) => {
  await setup(page); await page.goto('/')
  await page.getByRole('button', { name: 'Меня пригласили' }).click()
  await expect(page.getByText('Пока нет активных приглашений для вашего Telegram-аккаунта.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Проверить приглашения', exact: true })).toBeEnabled()
})
test('finance choice opens expense form', async ({ page }) => {
  await setup(page); await choose(page, /Записать расход/)
  await page.getByRole('button', { name: 'Создать семью и продолжить' }).click()
  await expect(page.getByRole('dialog', { name: 'Новый расход' })).toBeVisible()
})
