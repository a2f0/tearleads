/**
 * WebView context switching helpers for Capacitor apps
 *
 * Capacitor apps run in a WebView - we need to switch between:
 * - NATIVE_APP: For interacting with native UI elements (file pickers, permission dialogs)
 * - WEBVIEW_com.tearleads.rapid: For interacting with React components via CSS selectors
 */

let currentContext = 'NATIVE_APP';

export async function getAvailableContexts(): Promise<string[]> {
  return browser.getContexts();
}

export async function switchToWebViewContext(): Promise<void> {
  const maxRetries = 5;
  const retryDelay = 2000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const contexts = await getAvailableContexts();

    // Find the WebView context (for Capacitor apps, it's usually WEBVIEW_com.tearleads.rapid)
    const webviewContext = contexts.find(
      (ctx) => ctx.startsWith('WEBVIEW') || ctx.includes('tearleads')
    );

    if (webviewContext) {
      if (currentContext !== webviewContext) {
        await browser.switchContext(webviewContext);
        currentContext = webviewContext;
      }
      return;
    }

    // WebView not found - try to bring app back to foreground
    if (attempt < maxRetries - 1) {
      console.log(
        `WebView not found (attempt ${attempt + 1}/${maxRetries}), waiting...`
      );

      // Try to activate the app (might help after native dialogs)
      try {
        await browser.execute('mobile: activateApp', {
          bundleId: 'com.tearleads.rapid',
        });
      } catch {
        // activateApp might not be supported, continue anyway
      }

      await browser.pause(retryDelay);
    }
  }

  const finalContexts = await getAvailableContexts();
  throw new Error(
    `No WebView context found after ${maxRetries} attempts. Available: ${finalContexts.join(', ')}`
  );
}

export async function switchToNativeContext(): Promise<void> {
  if (currentContext !== 'NATIVE_APP') {
    await browser.switchContext('NATIVE_APP');
    currentContext = 'NATIVE_APP';
  }
}

export async function getCurrentContext(): Promise<string> {
  return browser.getContext() as Promise<string>;
}

/**
 * Execute a function in native context, then restore previous context
 */
export async function withNativeContext<T>(fn: () => Promise<T>): Promise<T> {
  const previousContext = currentContext;
  await switchToNativeContext();
  try {
    return await fn();
  } finally {
    if (previousContext !== 'NATIVE_APP') {
      await browser.switchContext(previousContext);
      currentContext = previousContext;
    }
  }
}

/**
 * Execute a function in WebView context, then restore previous context
 */
export async function withWebViewContext<T>(fn: () => Promise<T>): Promise<T> {
  const previousContext = currentContext;
  await switchToWebViewContext();
  try {
    return await fn();
  } finally {
    if (previousContext !== currentContext) {
      await browser.switchContext(previousContext);
      currentContext = previousContext;
    }
  }
}

/**
 * Wait for WebView to become available
 */
export async function waitForWebView(timeout = 30000): Promise<void> {
  const pollInterval = 500;
  const maxTries = timeout / pollInterval;

  for (let i = 0; i < maxTries; i++) {
    try {
      const contexts = await getAvailableContexts();
      const hasWebView = contexts.some(
        (ctx) => ctx.startsWith('WEBVIEW') || ctx.includes('tearleads')
      );
      if (hasWebView) {
        return;
      }
    } catch {
      // Ignore errors while polling
    }
    await browser.pause(pollInterval);
  }

  throw new Error(`WebView not available after ${timeout}ms`);
}
