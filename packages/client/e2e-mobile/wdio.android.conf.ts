import { config as baseConfig } from './wdio.conf.js';
import type { Options } from '@wdio/types';
import { startAppiumServer } from './utils/appium-server.js';

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
      'appium:app': '../android/app/build/outputs/apk/debug/app-debug.apk',
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
