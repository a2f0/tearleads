/**
 * App loads test - verifies the app launches correctly
 * Ported from: .maestro/app-loads.yaml
 */

import { launchAppWithClearState } from '../helpers/app-lifecycle.js';
import { switchToWebViewContext, waitForWebView } from '../helpers/webview-helpers.js';

describe('App Loads', () => {
  before(async () => {
    await launchAppWithClearState();
    await waitForWebView();
  });

  it('should display the Tearleads app title', async () => {
    await switchToWebViewContext();

    // Verify the app title is visible
    const title = await $('*=Tearleads');
    await expect(title).toBeDisplayed();
  });

  it('should display the app container', async () => {
    await switchToWebViewContext();

    const container = await $('[data-testid="app-container"]');
    await expect(container).toBeExisting();
  });
});
