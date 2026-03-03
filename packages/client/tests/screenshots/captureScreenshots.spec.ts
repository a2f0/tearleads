import * as path from 'node:path';
import { test } from '@playwright/test';

interface Screen {
  route: string;
  name: string;
  skip?: boolean;
}

const SCREENS: Screen[] = [
  { route: '/', name: 'home' },
  { route: '/contacts', name: 'contacts' },
  { route: '/calendar', name: 'calendar' },
  { route: '/photos', name: 'photos' },
  { route: '/notes', name: 'notes' },
  { route: '/documents', name: 'documents' },
  { route: '/audio', name: 'audio' },
  { route: '/videos', name: 'videos' },
  { route: '/files', name: 'files' },
  { route: '/settings', name: 'settings' },
  { route: '/health', name: 'health' },
  { route: '/wallet', name: 'wallet' },
  { route: '/keychain', name: 'keychain' },
  { route: '/sqlite', name: 'sqlite' },
  { route: '/analytics', name: 'analytics' },
  { route: '/search', name: 'search' },
  { route: '/help', name: 'help' },
  { route: '/compliance', name: 'compliance' },
  { route: '/models', name: 'models' },
  { route: '/licenses', name: 'licenses' },
  { route: '/businesses', name: 'businesses' },
  { route: '/vehicles', name: 'vehicles' },
  { route: '/console', name: 'console' },
  { route: '/debug', name: 'debug' },
  { route: '/admin', name: 'admin' },
  { route: '/sync', name: 'sync' },
  { route: '/vfs', name: 'vfs' },
  { route: '/classic', name: 'classic' },
  { route: '/backups', name: 'backups' },
  { route: '/camera', name: 'camera' },
  // Auth-guarded routes - skip until auth fixtures are available
  { route: '/ai', name: 'ai', skip: true },
  { route: '/email', name: 'email', skip: true },
  { route: '/mls-chat', name: 'mls-chat', skip: true },
];

const DISABLE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
`;

for (const screen of SCREENS) {
  test(`capture ${screen.name}`, async ({ page }, testInfo) => {
    if (screen.skip) {
      test.skip();
      return;
    }

    await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });
    await page.goto(screen.route);
    await page.waitForSelector('[data-testid="app-container"]', {
      timeout: 10000,
    });
    // Brief settle for any remaining layout shifts
    await page.waitForTimeout(500);

    const project = testInfo.project.name; // 'mobile' or 'browser'
    const screenshotPath = path.join(
      process.cwd(),
      '.screenshots',
      project,
      `${screen.name}.png`,
    );

    await page.screenshot({ path: screenshotPath, fullPage: false });
  });
}
