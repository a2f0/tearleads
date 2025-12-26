import { config as baseConfig } from './wdio.conf.js';
import type { Options } from '@wdio/types';
import { startAppiumServer } from './utils/appium-server.js';

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
