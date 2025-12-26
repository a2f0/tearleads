import type { Options } from '@wdio/types';

export const config: Options.Testrunner = {
  runner: 'local',

  autoCompileOpts: {
    tsNodeOpts: {
      project: './e2e-mobile/tsconfig.json',
    },
  },

  specs: ['./specs/**/*.spec.ts'],
  exclude: [],

  // Mobile tests must run sequentially
  maxInstances: 1,

  // Capabilities are overridden in platform-specific configs
  capabilities: [],

  // Appium server connection
  hostname: '127.0.0.1',
  port: 4723,
  path: '/',

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000, // 2 minutes per test for mobile
  },

  reporters: [
    'spec',
    [
      'allure',
      {
        outputDir: 'allure-results',
        disableWebdriverStepsReporting: true,
      },
    ],
  ],

  // Hooks
  beforeSession: async function () {
    // Wait for app to fully load before starting tests
  },

  beforeTest: async function () {
    // Give WebView time to be available
    await browser.pause(1000);
  },

  afterTest: async function (
    _test: unknown,
    _context: unknown,
    result: { error?: Error; passed: boolean }
  ) {
    // Take screenshot on failure
    if (!result.passed) {
      await browser.takeScreenshot();
    }
  },
};
