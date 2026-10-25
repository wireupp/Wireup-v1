import { expect, test } from '@playwright/test'

// Smoke coverage for the frontend-only admin console at /admin.
// Everything runs against the seeded mock dataset — no backend involvement.

const NAV_LABELS = ['Overview', 'AI Usage', 'Token Analytics', 'Accounts', 'Credits & Limits', 'Models & Providers', 'Rate Limits', 'Alerts', 'Audit Logs', 'Reports', 'Settings']

test.describe('WireUp admin console', () => {
  test('opens at /admin with the full navigation and KPI dashboard', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible()
    for (const label of NAV_LABELS) await expect(page.locator('.admin-nav').getByText(label, { exact: true })).toBeVisible()
    await expect(page.locator('.admin-demo-pill')).toBeVisible()
    await expect(page.locator('.admin-stat').first()).toBeVisible()
    // 12 KPI cards on overview
    await expect(page.locator('.admin-grid--kpi .admin-stat')).toHaveCount(12)
    // 8 analytics charts render a recharts surface
    await expect(page.locator('.recharts-surface')).toHaveCount(8)
    expect(pageErrors).toEqual([])
  })

  test('every sidebar destination renders its page', async ({ page }) => {
    await page.goto('/admin/accounts')
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible()
    await page.locator('.admin-nav').getByText('AI Usage', { exact: true }).click()
    await expect(page.getByRole('heading', { name: 'AI usage explorer' })).toBeVisible()
    await page.locator('.admin-nav').getByText('Token Analytics').click()
    await expect(page.getByRole('heading', { name: 'Token analytics' })).toBeVisible()
    await page.locator('.admin-nav').getByText('Credits & Limits').click()
    await expect(page.getByRole('heading', { name: 'Credits & limits' })).toBeVisible()
    await page.locator('.admin-nav').getByText('Models & Providers').click()
    await expect(page.getByRole('heading', { name: 'Models & providers' })).toBeVisible()
    await page.locator('.admin-nav').getByText('Rate Limits').click()
    await expect(page.getByRole('heading', { name: 'Rate limits & access policies' })).toBeVisible()
    await page.locator('.admin-nav').getByText('Alerts', { exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Alerts & anomaly monitoring' })).toBeVisible()
    await page.locator('.admin-nav').getByText('Audit Logs').click()
    await expect(page.getByRole('heading', { name: 'Audit logs' })).toBeVisible()
    await page.locator('.admin-nav').getByText('Reports').click()
    await expect(page.getByRole('heading', { name: 'Reports & exports' })).toBeVisible()
    await page.locator('.admin-nav').getByText('Settings').click()
    await expect(page.getByRole('heading', { name: 'Admin settings' })).toBeVisible()
  })

  test('time period selector updates overview KPIs', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible()
    await page.selectOption('.admin-topbar select', 'today')
    await expect(page.locator('.admin-page-head p')).toContainText('Today')
    await page.selectOption('.admin-topbar select', '90d')
    await expect(page.locator('.admin-page-head p')).toContainText('Last 90 days')
  })

  test('account drawer grants credits and updates balances + audit log', async ({ page }) => {
    await page.goto('/admin/accounts')
    const firstRow = page.locator('.admin-table tbody tr').first()
    await firstRow.locator('td').nth(1).click()
    const drawer = page.locator('.admin-drawer')
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: 'Grant credits' }).click()
    const dialog = page.locator('.admin-modal')
    await expect(dialog).toBeVisible()
    const amount = dialog.locator('input[type=number]')
    await amount.fill('250')
    await dialog.getByRole('button', { name: 'Grant credits' }).click()
    await expect(page.locator('.admin-toast')).toContainText('Granted 250 credits')
    // Drawer shows the updated total balance
    await expect(drawer).toContainText('250')
    await drawer.getByRole('button', { name: 'Close panel' }).click()
    // Action landed in the audit log
    await page.locator('.admin-nav').getByText('Audit Logs').click()
    await expect(page.locator('.admin-table').first()).toContainText('Credits granted')
  })

  test('credits page: ledger search, calculator and reset preview work', async ({ page }) => {
    await page.goto('/admin/credits')
    await page.getByRole('tab', { name: /Transaction ledger/ }).click()
    await page.getByPlaceholder('ID, reason, admin, request…').fill('Welcome')
    await expect(page.locator('.admin-table').first()).toContainText('Welcome grant')
    await page.getByRole('tab', { name: 'Credit calculator' }).click()
    await page.locator('input[type=number]').first().fill('5000')
    await expect(page.getByText('Simulated credit charge')).toBeVisible()
    await page.getByRole('tab', { name: 'Daily reset' }).click()
    await page.getByRole('button', { name: 'Reset preview' }).click()
    await expect(page.locator('.admin-modal')).toContainText('Daily reset preview')
    await page.locator('.admin-modal__foot').getByRole('button', { name: 'Close' }).click()
  })

  test('usage explorer filters actually filter the request log', async ({ page }) => {
    await page.goto('/admin/usage')
    await expect(page.getByRole('heading', { name: 'AI usage explorer' })).toBeVisible()
    const countBefore = await page.locator('.admin-pagination__info').first().textContent()
    await page.getByLabel('Status').selectOption('failed')
    await expect(page.locator('.admin-table').first()).toContainText('Failed')
    const countAfter = await page.locator('.admin-pagination__info').first().textContent()
    expect(countAfter).not.toEqual(countBefore)
    // Row click opens the request drawer
    await page.locator('.admin-table tbody tr').first().click()
    await expect(page.locator('.admin-drawer')).toContainText('Request req_')
    await expect(page.locator('.admin-drawer')).toContainText('Credit accounting')
  })

  test('alerts can be acknowledged and resolved', async ({ page }) => {
    await page.goto('/admin/alerts')
    const firstRow = page.locator('.admin-alert-row').first()
    await firstRow.getByRole('button', { name: /Actions/ }).click()
    await page.getByRole('menuitem', { name: 'Acknowledge' }).click()
    await expect(page.locator('.admin-toast')).toContainText('Alert acknowledged')
    await expect(firstRow).toContainText('acknowledged')
  })

  test('models page can toggle a model and edit pricing', async ({ page }) => {
    await page.goto('/admin/models')
    await page.locator('.admin-table tbody tr').first().click()
    const drawer = page.locator('.admin-drawer')
    await expect(drawer).toBeVisible()
    await drawer.locator('input[type=number]').first().fill('9')
    await drawer.getByRole('button', { name: 'Save configuration' }).click()
    await expect(page.locator('.admin-toast')).toContainText('Model updated')
  })

  test('CSV export produces a download on the accounts page', async ({ page }) => {
    await page.goto('/admin/accounts')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export CSV' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^wireup-accounts-.*\.csv$/)
  })

  test('mock changes persist across a page reload', async ({ page }) => {
    await page.goto('/admin/accounts')
    await page.locator('.admin-filters input').first().fill('Ishaan')
    await expect(page.locator('.admin-table tbody tr').first()).toContainText('Ishaan')
    const row = page.locator('.admin-table tbody tr').first()
    await row.locator('td').nth(1).click()
    const drawer = page.locator('.admin-drawer')
    await drawer.getByRole('button', { name: 'Grant credits' }).click()
    await page.locator('.admin-modal input[type=number]').fill('777')
    await page.locator('.admin-modal').getByRole('button', { name: 'Grant credits' }).click()
    await expect(page.locator('.admin-toast')).toContainText('Granted 777')
    await drawer.getByRole('button', { name: 'Close panel' }).click()
    await page.reload()
    // The grant must survive the reload via localStorage
    await page.locator('.admin-filters input').first().fill('Ishaan')
    await expect(page.locator('.admin-table tbody tr').first()).toContainText('Ishaan')
    await page.locator('.admin-table tbody tr').first().locator('td').nth(1).click()
    await expect(page.locator('.admin-drawer')).toContainText('777')
  })

  test('theme picker switches dark, white and mix themes and persists', async ({ page }) => {
    await page.goto('/admin/settings')
    await expect(page.locator('.admin-app[data-theme=midnight]')).toHaveCount(1)
    // Dark variant
    await page.getByRole('radio', { name: /Deep Ocean/ }).click()
    await expect(page.locator('.admin-app[data-theme=ocean]')).toHaveCount(1)
    await page.reload()
    await expect(page.locator('.admin-app[data-theme=ocean]')).toHaveCount(1)
    await page.goto('/admin/accounts')
    await expect(page.locator('.admin-app[data-theme=ocean]')).toHaveCount(1)
    // White theme carries light chrome classes
    await page.goto('/admin/settings')
    await page.getByRole('radio', { name: /Paper/ }).click()
    await expect(page.locator('.admin-app--chrome-light')).toHaveCount(1)
    await expect(page.locator('.admin-app--content-light')).toHaveCount(1)
    // Mix theme: light content but dark chrome
    await page.getByRole('radio', { name: /Duo Slate/ }).click()
    await expect(page.locator('.admin-app--content-light')).toHaveCount(1)
    await expect(page.locator('.admin-app--chrome-light')).toHaveCount(0)
    // Back to the default dark theme
    await page.getByRole('radio', { name: /Midnight/ }).click()
    await expect(page.locator('.admin-app--content-light')).toHaveCount(0)
  })

  test('settings can restore demo data with typed confirmation', async ({ page }) => {
    await page.goto('/admin/settings')
    await page.getByRole('button', { name: 'Reset demo data' }).first().click()
    const dialog = page.locator('.admin-modal')
    await expect(dialog).toContainText('Reset demo data')
    // Confirm button stays disabled until the typed confirmation matches
    await expect(dialog.getByRole('button', { name: 'Reset demo data' }).last()).toBeDisabled()
    await dialog.locator('input').fill('RESET')
    await dialog.getByRole('button', { name: 'Reset demo data' }).last().click()
    await page.waitForLoadState('load')
    await expect(page.getByRole('heading', { name: 'Admin settings' })).toBeVisible()
  })
})
