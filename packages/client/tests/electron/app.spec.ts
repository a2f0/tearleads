import {test, expect, _electron as electron, ElectronApplication, Page} from '@playwright/test';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json') as {version: string};

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '../../out/main/main.js');
const isCI = !!process.env['CI'];
const APP_LOAD_TIMEOUT = 10000;

test.describe('Electron App', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    electronApp = await electron.launch({
      args: isCI ? [mainPath, '--no-sandbox', '--disable-gpu'] : [mainPath],
    });
    window = await electronApp.firstWindow();
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should launch and display the main window with version in title', async () => {
    const heading = window.getByRole('heading', {name: 'Tearleads', level: 1});
    await expect(heading).toBeVisible({timeout: APP_LOAD_TIMEOUT});

    // Wait for title to be set after page load
    const expectedTitle = `Tearleads v${packageJson.version}`;
    await expect(async () => {
      const title = await window.title();
      expect(title).toBe(expectedTitle);
    }).toPass({timeout: 5000});
  });

  test('should navigate to settings page', async () => {
    const settingsLink = window.getByTestId('settings-link');
    await expect(settingsLink).toBeVisible({timeout: APP_LOAD_TIMEOUT});

    await settingsLink.click();

    await expect(
      window.getByRole('heading', {name: 'Settings'})
    ).toBeVisible();
  });
});
