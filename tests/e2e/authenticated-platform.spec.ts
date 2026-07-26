import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const email = `launch-audit-${Date.now()}@example.test`
const password = 'ForgeVid-Audit-2026!'

test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

test('registration creates a real session and opens the dashboard', async ({ page }) => {
  await page.goto('/auth/signup')
  await page.getByLabel('Full Name').fill('Launch Audit User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm Password').fill(password)
  const registrationResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/register'),
  )
  await page.getByRole('button', { name: 'Create Account' }).click()
  const registrationResponse = await registrationResponsePromise
  expect(
    registrationResponse.status(),
    `registration failed: ${await registrationResponse.text()}`,
  ).toBe(201)
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })
  await expect(page.getByRole('heading').first()).toBeVisible()
})

test('credentials login and authenticated product surfaces work', async ({ page }) => {
  await page.goto('/auth/signin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })

  for (const path of [
    '/dashboard/videos',
    '/dashboard/ai',
    '/dashboard/feed',
    '/dashboard/ad-studio',
    '/dashboard/recommendations',
    '/dashboard/approvals',
    '/dashboard/analytics',
    '/dashboard/media',
    '/dashboard/templates',
    '/dashboard/collaborate',
    '/dashboard/settings',
    '/dashboard/billing',
  ]) {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    expect(response?.status(), `${path} should load`).toBeLessThan(400)
    await expect(page).not.toHaveURL(/\/auth\/(signin|login)/)
    await expect(page.locator('body')).not.toContainText('Internal Server Error')
  }
  await expect(page.getByRole('heading', { name: /Billing & Subscription/i })).toBeVisible()
  await expect(page.getByText(/Current Plan/i).first()).toBeVisible()
})

test('all supported account languages persist and render the Growth Operator', async ({ page }) => {
  await page.goto('/auth/signin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })

  const localizedHeadings: Record<string, string> = {
    en: 'What to promote next',
    es: 'Qué promocionar ahora',
    hi: 'अगला प्रचार क्या करें',
    zh: '下一步推广什么',
    ja: '次に宣伝するもの',
    fr: 'Que promouvoir ensuite',
    it: 'Cosa promuovere ora',
    ko: '다음에 홍보할 항목',
    pt: 'O que promover agora',
    de: 'Was als Nächstes bewerben',
  }
  for (const [language, heading] of Object.entries(localizedHeadings)) {
      const saved = await page.evaluate(async (nextLanguage) => {
        const csrf = document.cookie
          .split('; ')
          .find((entry) => entry.startsWith('csrf-token='))
          ?.slice('csrf-token='.length)
        const response = await fetch('/api/user/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}),
          },
          body: JSON.stringify({
            preferences: {
              language: nextLanguage,
              timezone: 'UTC-5',
              theme: 'system',
              autoSave: true,
              qualityPreference: 'high',
            },
          }),
        })
        return { status: response.status, body: await response.json().catch(() => ({})) }
      }, language)
      expect(saved.status, `${language} preferences should persist: ${JSON.stringify(saved.body)}`).toBe(200)
      const response = await page.goto('/dashboard/recommendations', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      })
      expect(response?.status(), `${language} Growth Operator should load`).toBeLessThan(400)
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      await expect(page.getByText(/Internal Server Error/i)).toHaveCount(0)
  }
})

test('admin and SSO surfaces enforce fresh database authorization', async ({ page }) => {
  const prisma = new PrismaClient()
  try {
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } })
  } finally {
    await prisma.$disconnect()
  }

  await page.goto('/auth/signin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })

  for (const path of ['/admin', '/admin/security/sso']) {
    const response = await page.goto(path)
    expect(response?.status(), `${path} should load for an admin`).toBeLessThan(400)
    await expect(page).not.toHaveURL(/\/unauthorized/)
    await expect(page.locator('body')).not.toContainText('Internal Server Error')
  }
})
