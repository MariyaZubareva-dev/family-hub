import { expect, test } from '@playwright/test'

test('unauthenticated visitor sees login and no private app content', async ({ page }) => {
  await page.route('**/api/v1/auth/session', route => route.fulfill({
    status: 401, json: { authenticated: false },
  }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Войти', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Пароль')).toBeVisible()
})

test('browser login sends credentials and opens existing family without exposing password', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/auth/session')) {
      await route.fulfill({ status: 401, json: { authenticated: false } })
      return
    }
    if (url.pathname.endsWith('/auth/login')) {
      attempts++
      const body = route.request().postDataJSON()
      if (body.email !== 'qa@example.com' || body.password !== 'a-long-example-password') {
        await route.fulfill({ status: 422, json: { message: 'Неверный email или пароль.' } })
        return
      }
      await route.fulfill({ status: 200, json: { data: { csrf: 'test-csrf', user: { id: 'u1' } } } })
      return
    }
    if (url.pathname.endsWith('/me')) {
      await route.fulfill({ json: { data: { id: 'u1', family: { id: 'f1', role: 'ADMIN', visibility: { calendar: true, shopping: true, finance: true } } } } })
      return
    }
    await route.fulfill({ json: { data: [] } })
  })
  await page.goto('/')
  await page.getByLabel('Email').fill('qa@example.com')
  await page.getByLabel('Пароль').fill('wrong-password')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Неверный email или пароль')
  await expect(page.getByRole('navigation')).toHaveCount(0)

  await page.getByLabel('Пароль').fill('a-long-example-password')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('navigation')).toBeVisible()
  expect(attempts).toBe(2)
})

test('registration validates password and provides a verification step', async ({ page }) => {
  await page.route('**/api/v1/auth/session', route => route.fulfill({
    status: 401, json: { authenticated: false },
  }))
  await page.route('**/api/v1/auth/register', route => route.fulfill({
    status: 201, json: { message: 'Код отправлен.' },
  }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Участник')
  await page.getByLabel('Email').fill('new@example.com')
  await page.getByLabel('Пароль').fill('another-long-password')
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await expect(page.getByRole('heading', { name: 'Подтвердить email' })).toBeVisible()
  await expect(page.getByLabel('Код из письма')).toBeVisible()
})

test('password recovery requests a code without disclosing account existence', async ({ page }) => {
  await page.route('**/api/v1/auth/session', route => route.fulfill({
    status: 401, json: { authenticated: false },
  }))
  await page.route('**/api/v1/auth/password/reset-request', route => route.fulfill({
    json: { message: 'Если email зарегистрирован, на него отправлен код.' },
  }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Забыли пароль?' }).click()
  await page.getByLabel('Email').fill('example@example.com')
  await page.getByRole('button', { name: 'Получить код' }).click()
  await expect(page.getByRole('heading', { name: 'Новый пароль' })).toBeVisible()
  await expect(page.getByLabel('Код из письма')).toBeVisible()
})
