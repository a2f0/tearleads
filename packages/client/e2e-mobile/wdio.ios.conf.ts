import { config as baseConfig } from './wdio.conf.js';
import type { Options } from '@wdio/types';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appiumHome = path.resolve(__dirname, '..', '.appium');

// Start Appium server with proper APPIUM_HOME before tests run
const startAppiumServer = (): void => {
  // Check if Appium is already running
  try {
    execSync('curl -s http://127.0.0.1:4723/status', { stdio: 'pipe' });
    console.log('Appium server already running');
    return;
  } catch {
    // Not running, start it
  }

  console.log(`Starting Appium server with APPIUM_HOME=${appiumHome}`);
  execSync(
    `APPIUM_HOME="${appiumHome}" npm exec -- appium --base-path / --relaxed-security --port 4723 &`,
    { stdio: 'inherit', shell: '/bin/bash' }
  );

  // Wait for Appium to be ready
  let attempts = 0;
  while (attempts < 30) {
    try {
      execSync('curl -s http://127.0.0.1:4723/status', { stdio: 'pipe' });
      console.log('Appium server is ready');
      return;
    } catch {
      attempts++;
      execSync('sleep 1');
    }
  }
  throw new Error('Appium server failed to start');
};

export const config: Options.Testrunner = {
  ...baseConfig,

  // Empty services - no appium service, we start Appium manually
  services: [],

  onPrepare: async () => {
    startAppiumServer();
  },

  capabilities: [
    {
      platformName: 'iOS',
      'appium:deviceName': 'iPhone 16',
      'appium:platformVersion': '18.2',
      'appium:automationName': 'XCUITest',
      'appium:app': './ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app',
      'appium:bundleId': 'com.tearleads.rapid',
      'appium:noReset': false,
      'appium:fullReset': false,
      'appium:newCommandTimeout': 300,
      // Critical for Capacitor WebView testing - we handle context switching manually
      'appium:autoWebview': false,
      'appium:webviewConnectTimeout': 30000,
      'appium:includeSafariInWebviews': true,
      // We handle alerts manually for permission dialogs
      'appium:autoAcceptAlerts': false,
    },
  ],
};
