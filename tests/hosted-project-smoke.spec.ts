import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`project API supports home and workspace at ${width}px`, async ({ page, request }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 900 })
    const listed = page.waitForResponse(response => response.url().endsWith('/api/hardware/projects'))
    await page.goto('/')
    expect((await listed).status()).toBe(200)
    await expect(page.getByText('The hardware service is unavailable.', { exact: false })).toHaveCount(0)
    const created = page.waitForResponse(response => response.url().endsWith('/api/hardware/projects') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'New prototype', exact: true }).click()
    const response = await created
    expect(response.status()).toBe(200)
    const project = await response.json()
    try {
      await expect(page).toHaveURL(`/project/${project.id}`)
      await expect(page.getByRole('region', { name: 'Circuit canvas', exact: true })).toBeVisible({ timeout: 30_000 })
      await page.goto('/')
      await expect(page.locator(`a[href="/project/${project.id}"]`)).toBeVisible()
      await page.goto('/projects')
      await expect(page.locator(`a[href="/project/${project.id}"]`)).toBeVisible()
      await page.locator(`a[href="/project/${project.id}"]`).click()
      await expect(page.getByRole('region', { name: 'Circuit canvas', exact: true })).toBeVisible({ timeout: 30_000 })
      await page.reload()
      await expect(page.getByRole('region', { name: 'Circuit canvas', exact: true })).toBeVisible({ timeout: 30_000 })
    } finally {
      await page.goto('about:blank')
      await request.delete(`/api/hardware/projects/${project.id}`)
    }
  })
}
