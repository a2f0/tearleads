import {test, expect, _electron as electron, ElectronApplication} from '@playwright/test';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '../../out/main/main.js');

let electronApp: ElectronApplication;

test.beforeEach(async () => {
  electronApp = await electron.launch({
    args: [mainPath],
  });
});

test.afterEach(async () => {
  await electronApp.close();
});

test.describe('Electron App', () => {
  test('should launch and display the main window', async () => {
    const window = await electronApp.firstWindow();

    // Wait for React to render
    const heading = window.getByRole('heading', {name: 'Tearleads', level: 1});
    await expect(heading).toBeVisible({timeout: 10000});

    // Check the title
    const title = await window.title();
    expect(title).toBe('Tearleads');
  });

  test('should have the root element mounted', async () => {
    const window = await electronApp.firstWindow();

    // Wait for React to render
    const appContainer = window.getByTestId('app-container');
    await expect(appContainer).toBeVisible({timeout: 10000});

    const rootElement = window.locator('#root');
    await expect(rootElement).not.toBeEmpty();
  });

  test('should navigate to settings page', async () => {
    const window = await electronApp.firstWindow();

    // Wait for app to load
    const settingsLink = window.getByTestId('settings-link');
    await expect(settingsLink).toBeVisible({timeout: 10000});

    await settingsLink.click();

    await expect(
      window.getByRole('heading', {name: 'Settings'})
    ).toBeVisible();
  });
});
