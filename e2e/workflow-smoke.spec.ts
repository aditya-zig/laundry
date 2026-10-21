import { test, expect } from '@playwright/test';

test('SMOKE-CUSTOMER: catalog, service detail and basket preserve chosen quantity', async ({ page }) => {
  await test.step('Open the actual customer app and load demo services', async () => {
    await page.goto('http://localhost:8081');
    await expect(page.getByRole('heading', { name: 'Laundry', exact: true })).toBeVisible();
    await page.getByText('Continue with demo sign-in', { exact: true }).click();
    await expect(page.getByText('Wash and Fold', { exact: true })).toBeVisible();
  });
  await test.step('Choose two garments and verify the resulting basket', async () => {
    await page.getByText('Wash and Fold', { exact: true }).click();
    await page.getByLabel('Quantity for T-shirt', { exact: true }).fill('2');
    await page.getByText('Add to basket', { exact: true }).click();
    await expect(page.getByText('2 item(s) added to basket.', { exact: true })).toBeVisible();
    await page.getByText('Review basket', { exact: true }).click();
    await expect(page.getByText('Total garments: 2', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Quantity for line 1', { exact: true })).toHaveValue('2');
  });
});

test('SMOKE-RIDER: isolated demo rider can load assigned tasks', async ({ page }) => {
  await page.goto('http://localhost:8082');
  await page.getByRole('button', { name: '[DEMO] Sign in as Rider', exact: true }).click();
  await expect(page.getByText(/Assigned Tasks \(\d+\)/)).toBeVisible();
  await expect(page.getByText('DEMO MODE — PARTNER APP', { exact: true })).toBeVisible();
});

test('SMOKE-OPS: operator sign-in opens the real service catalog', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://localhost:5173');
  await page.getByRole('button', { name: 'Continue with demo operator sign-in' }).click();
  await page.getByRole('link', { name: 'Catalog', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Service and price configuration' })).toBeVisible();
  await expect(page.getByText('Wash and Fold', { exact: true })).toBeVisible();
});
