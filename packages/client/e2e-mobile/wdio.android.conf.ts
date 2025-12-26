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

// Note: We don't use the appium service - we manage Appium startup ourselves
// to ensure APPIUM_HOME is properly set for driver discovery

export const config: Options.Testrunner = {
  ...baseConfig,

  // Empty services - no appium service, we start Appium manually
  services: [],

  onPrepare: async () => {
    startAppiumServer();
  },

  capabilities: [
    {
      platformName: 'Android',
      'appium:deviceName': 'Android Emulator',
      'appium:platformVersion': '15',
      'appium:automationName': 'UiAutomator2',
      'appium:app': './android/app/build/outputs/apk/debug/app-debug.apk',
      'appium:appPackage': 'com.tearleads.rapid',
      'appium:appActivity': 'com.tearleads.rapid.MainActivity',
      'appium:noReset': false,
      'appium:fullReset': false,
      'appium:newCommandTimeout': 300,
      // Critical for Capacitor WebView testing - we handle context switching manually
      'appium:autoWebview': false,
      'appium:chromedriverAutodownload': true,
      'appium:nativeWebScreenshot': true,
      // For file picker automation
      'appium:autoGrantPermissions': true,
    },
  ],
};
