import type { Page } from '@playwright/test';
import { expect } from '../fixtures';

interface SetDeferredPasswordOptions {
  password: string;
  timeout: number;
}

export async function expectAutoInitializedDeferredState(
  page: Page,
  timeout: number
): Promise<void> {
  await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
    timeout
  });
  await expect(page.getByTestId('db-password-status')).toHaveText('Not Set');
  await expect(page.getByTestId('db-set-password-button')).toBeVisible();
}

export async function setPasswordOnDeferredInstance(
  page: Page,
  options: SetDeferredPasswordOptions
): Promise<void> {
  const { password, timeout } = options;

  await page.getByTestId('db-password-input').fill(password);
  await page.getByTestId('db-set-password-button').click();
  await expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'success',
    { timeout }
  );
  await expect(page.getByTestId('db-test-result')).toContainText(
    'Password set successfully'
  );
}
