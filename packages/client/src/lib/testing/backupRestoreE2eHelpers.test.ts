import { describe, expect, it, vi } from 'vitest';
import {
  navigateInApp,
  setupDatabaseForBackup,
  writeDatabaseTestData
} from './backupRestoreE2eHelpers';

function createLocator(text: string | null = null) {
  return {
    click: vi.fn(async () => {}),
    fill: vi.fn(async (_value: string) => {}),
    textContent: vi.fn(async () => text)
  };
}

describe('backupRestoreE2eHelpers', () => {
  it('navigates in-app and optionally waits for URL', async () => {
    const page = {
      evaluate: vi.fn(async () => {}),
      waitForURL: vi.fn(async (_value: string) => {}),
      getByTestId: vi.fn((_testId: string) => createLocator())
    };

    await navigateInApp(page, '/sqlite', true);

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.waitForURL).toHaveBeenCalledWith('**/sqlite');
  });

  it('navigates without waiting for URL when waitForUrl is false', async () => {
    const page = {
      evaluate: vi.fn(async () => {}),
      waitForURL: vi.fn(async (_value: string) => {}),
      getByTestId: vi.fn((_testId: string) => createLocator())
    };

    await navigateInApp(page, '/settings', false);

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.waitForURL).not.toHaveBeenCalled();
  });

  it('sets up database flow', async () => {
    const resetButton = createLocator();
    const passwordInput = createLocator();
    const setupButton = createLocator();
    const fallback = createLocator();
    const page = {
      evaluate: vi.fn(async () => {}),
      getByTestId: vi.fn((testId: string) => {
        if (testId === 'db-reset-button') return resetButton;
        if (testId === 'db-password-input') return passwordInput;
        if (testId === 'db-setup-button') return setupButton;
        return fallback;
      })
    };
    const navigate = vi.fn(async (_path: string) => {});

    await setupDatabaseForBackup(page, navigate, 'secret');

    expect(navigate).toHaveBeenCalledWith('/sqlite');
    expect(resetButton.click).toHaveBeenCalledTimes(1);
    expect(passwordInput.fill).toHaveBeenCalledWith('secret');
    expect(setupButton.click).toHaveBeenCalledTimes(1);
  });

  it('writes test data and returns read value', async () => {
    const writeButton = createLocator();
    const testData = createLocator('test-value-123');
    const fallback = createLocator();
    const page = {
      evaluate: vi.fn(async () => {}),
      getByTestId: vi.fn((testId: string) => {
        if (testId === 'db-write-button') return writeButton;
        if (testId === 'db-test-data') return testData;
        return fallback;
      })
    };

    const result = await writeDatabaseTestData(page);

    expect(writeButton.click).toHaveBeenCalledTimes(1);
    expect(result).toBe('test-value-123');
  });
});
