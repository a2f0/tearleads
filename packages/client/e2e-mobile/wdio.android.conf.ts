import { config as baseConfig } from './wdio.conf.js';
import type { Options } from '@wdio/types';
import { startAppiumServer } from './utils/appium-server.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDir = join(__dirname, '..');

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
      // platformVersion omitted to auto-detect running emulator
      'appium:automationName': 'UiAutomator2',
      'appium:app': join(clientDir, 'android/app/build/outputs/apk/debug/app-debug.apk'),
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
