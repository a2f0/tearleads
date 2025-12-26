/**
 * Shared Appium server management utilities
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appiumHome = path.resolve(__dirname, '..', '..', '.appium');

/**
 * Start Appium server if not already running
 */
export function startAppiumServer(): void {
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
}

export { appiumHome };
