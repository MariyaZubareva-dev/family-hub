import { test as base, expect } from '@playwright/test'

// Existing UI scenarios mock the business API. Inject a valid browser session
// before the application boots, so authentication does not mask those scenarios.
// This stub is test-only and is never included in production bundles.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window)
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (new URL(url, window.location.href).pathname === '/api/v1/auth/session') {
          return Promise.resolve(new Response(JSON.stringify({
            authenticated: true, csrf: 'playwright-test-csrf',
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        return nativeFetch(input, init)
      }
    })
    await use(page)
  },
})
export { expect }
