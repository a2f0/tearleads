/**
 * App lifecycle helpers for launching, stopping, and restarting the app
 */

const APP_BUNDLE_ID = 'com.tearleads.rapid';

/**
 * Get the current platform
 */
export function getPlatform(): 'android' | 'ios' {
  const platformName = browser.capabilities.platformName;
  return (
    typeof platformName === 'string' ? platformName.toLowerCase() : 'android'
  ) as 'android' | 'ios';
}

/**
 * Launch app with a clean state (all data cleared)
 */
export async function launchAppWithClearState(): Promise<void> {
  // Terminate any running instance
  try {
    await browser.terminateApp(APP_BUNDLE_ID);
  } catch {
    // App might not be running
  }

  // Clear app data (Android only - iOS doesn't support this)
  const platform = getPlatform();
  if (platform === 'android') {
    try {
      await browser.execute('mobile: clearApp', { appId: APP_BUNDLE_ID });
    } catch {
      // clearApp might not be supported in all versions
    }
  }

  // Launch the app
  await browser.activateApp(APP_BUNDLE_ID);

  // Wait for app to fully load
  await browser.pause(3000);
}

/**
 * Launch app preserving existing state
 */
export async function launchAppPreserveState(): Promise<void> {
  try {
    await browser.terminateApp(APP_BUNDLE_ID);
  } catch {
    // App might not be running
  }

  await browser.activateApp(APP_BUNDLE_ID);
  await browser.pause(3000);
}

/**
 * Stop the app
 */
export async function stopApp(): Promise<void> {
  await browser.terminateApp(APP_BUNDLE_ID);
}

/**
 * Restart the app, optionally clearing state
 */
export async function restartApp(clearState = false): Promise<void> {
  await stopApp();
  await browser.pause(1000);

  if (clearState) {
    await launchAppWithClearState();
  } else {
    await launchAppPreserveState();
  }
}

/**
 * Put app in background for specified duration
 */
export async function backgroundApp(durationMs: number): Promise<void> {
  await browser.background(durationMs / 1000);
}

/**
 * Check if app is running
 */
export async function isAppRunning(): Promise<boolean> {
  try {
    const state = await browser.queryAppState(APP_BUNDLE_ID);
    // 4 = running in foreground, 3 = running in background
    return state === 4 || state === 3;
  } catch {
    return false;
  }
}
