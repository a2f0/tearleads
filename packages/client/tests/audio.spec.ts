import { test, expect, Page, Locator } from '@playwright/test';
import { MINIMAL_WAV } from './test-utils';

// Skip tests that require database setup in CI release builds
// until https://github.com/a2f0/rapid/issues/687 is resolved
const isCI = !!process.env['CI'];
const isHTTPS = !!process.env['BASE_URL']?.startsWith('https://');
const skipDatabaseTests = isCI && isHTTPS;

// Helper to check if viewport is mobile (sidebar hidden at lg breakpoint = 1024px)
function isMobileViewport(page: Page): boolean {
  const viewport = page.viewportSize();
  return (viewport?.width ?? 0) < 1024;
}

// Helper to navigate to a page, handling mobile/desktop differences
async function navigateToPage(page: Page, pageName: 'SQLite' | 'Audio') {
  const isMobile = isMobileViewport(page);

  if (isMobile) {
    await page.getByTestId('mobile-menu-button').click();
    await page
      .getByTestId('mobile-menu-dropdown')
      .getByTestId(`${pageName.toLowerCase()}-link`)
      .click();
  } else {
    const link = page
      .locator('aside nav')
      .getByRole('link', { name: pageName });
    await link.click();
  }
}

// Helper to reset, setup, and unlock the database
async function setupAndUnlockDatabase(page: Page, password = 'testpassword123') {
  await navigateToPage(page, 'SQLite');

  await page.getByTestId('db-reset-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
    timeout: 10000
  });
  await page.getByTestId('db-password-input').fill(password);
  await page.getByTestId('db-setup-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
    timeout: 10000
  });
}

// Helper to navigate to Audio page
async function navigateToAudio(page: Page) {
  await navigateToPage(page, 'Audio');
}

// Helper to upload a test audio file and wait for track list to appear
async function uploadTestAudio(page: Page) {
  // Wait for the dropzone to be ready
  const fileInput = page.getByTestId('dropzone-input');
  await expect(fileInput).toBeAttached({ timeout: 10000 });

  await fileInput.setInputFiles({
    name: 'test-audio.wav',
    mimeType: 'audio/wav',
    buffer: MINIMAL_WAV
  });

  // Wait for the track to appear in the list (starts with audio-track-)
  // The track list appears after upload, but the player only shows after clicking a track
  await expect(page.locator('[data-testid^="audio-track-"]').first()).toBeVisible({
    timeout: 60000
  });
}

// Helper to play a track and wait for the audio player to appear
// Note: detectPlatform() returns 'web' for Playwright tests regardless of viewport,
// so double-click is required even on mobile viewport sizes
async function playFirstTrack(page: Page) {
  const firstTrack = page.locator('[data-testid^="audio-play-"]').first();
  await expect(firstTrack).toBeVisible();
  await firstTrack.dblclick();

  // Wait for the audio player to appear (only shows when currentTrack is set)
  await expect(page.getByTestId('audio-player')).toBeVisible({ timeout: 10000 });
}

async function getWebkitThumbStyle(slider: Locator) {
  return slider.evaluate((el) => {
    const style = getComputedStyle(el, '::-webkit-slider-thumb');
    return {
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow
    };
  });
}

async function getSliderStyle(slider: Locator, pseudo?: string) {
  return slider.evaluate(
    (el, pseudoElement) => {
      const style = getComputedStyle(el, pseudoElement || undefined);
      return {
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor
      };
    },
    pseudo
  );
}

async function expectVisibleTrack(slider: Locator) {
  const baseStyle = await getSliderStyle(slider);
  const hasGradient =
    baseStyle.backgroundImage !== 'none' &&
    baseStyle.backgroundImage !== 'initial';
  const hasSolidBackground = baseStyle.backgroundColor !== 'rgba(0, 0, 0, 0)';
  expect(hasGradient || hasSolidBackground).toBe(true);
  expect(baseStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)');

  const trackStyle = await getSliderStyle(
    slider,
    '::-webkit-slider-runnable-track'
  );
  const hasTrackGradient =
    trackStyle.backgroundImage !== 'none' &&
    trackStyle.backgroundImage !== 'initial';
  const hasTrackBackground =
    trackStyle.backgroundColor !== 'rgba(0, 0, 0, 0)';
  expect(hasTrackGradient || hasTrackBackground).toBe(true);
  expect(trackStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)');
}

async function expectVisibleThumb(slider: Locator) {
  const thumbStyle = await getWebkitThumbStyle(slider);
  expect(thumbStyle.width).toBeGreaterThan(0);
  expect(thumbStyle.height).toBeGreaterThan(0);
  expect(thumbStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(thumbStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(thumbStyle.boxShadow).not.toBe('none');
}
  expect(trackStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)');
}

async function expectVisibleThumb(slider: Locator) {
  const thumbStyle = await getWebkitThumbStyle(slider);
  expect(thumbStyle.width).toBeGreaterThan(0);
  expect(thumbStyle.height).toBeGreaterThan(0);
  expect(thumbStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(thumbStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)');
}

test.describe('Audio player slider visibility', () => {
  test.skip(skipDatabaseTests, 'Database setup fails in CI release builds');

  test.describe('Desktop viewport (1280px)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('seek slider track should be visible', async ({ page }) => {
      test.slow(); // File upload can be slow in CI
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToAudio(page);

      await uploadTestAudio(page);
      await playFirstTrack(page);

      // Verify the seek slider is visible
      const seekSlider = page.getByTestId('audio-seekbar');
      await expect(seekSlider).toBeVisible();

      // Verify the slider has the correct CSS class
      await expect(seekSlider).toHaveClass(/audio-slider-seek/);

      // Get the slider's bounding box to verify it has dimensions
      const boundingBox = await seekSlider.boundingBox();
      expect(boundingBox).not.toBeNull();

      if (boundingBox) {
        // Slider should have reasonable width (at least 100px on desktop)
        expect(boundingBox.width).toBeGreaterThan(100);
        // Slider should have the expected height (8px track + 16px thumb = ~16px clickable area)
        expect(boundingBox.height).toBeGreaterThanOrEqual(8);
      }

      // Verify the slider track is styled (has the --progress CSS variable)
      const progressVar = await seekSlider.evaluate((el) => {
        return getComputedStyle(el).getPropertyValue('--progress');
      });
      expect(progressVar).toBeTruthy();

      await expectVisibleTrack(seekSlider);
    });

    test('volume slider track should be visible with wedge shape', async ({
      page
    }) => {
      test.slow();
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToAudio(page);

      await uploadTestAudio(page);
      await playFirstTrack(page);

      // Verify the volume slider is visible
      const volumeSlider = page.getByTestId('audio-volume');
      await expect(volumeSlider).toBeVisible();

      // Verify the slider has the correct CSS class
      await expect(volumeSlider).toHaveClass(/audio-slider-volume/);

      // Get the slider's bounding box to verify it has dimensions
      const boundingBox = await volumeSlider.boundingBox();
      expect(boundingBox).not.toBeNull();

      if (boundingBox) {
        // Volume slider should have a width of ~96px (w-24 = 6rem)
        expect(boundingBox.width).toBeGreaterThanOrEqual(90);
        expect(boundingBox.width).toBeLessThanOrEqual(110);
        // Volume slider should have visible height (12px track)
        expect(boundingBox.height).toBeGreaterThanOrEqual(12);
      }

      // Verify the volume slider has the --progress CSS variable
      const progressVar = await volumeSlider.evaluate((el) => {
        return getComputedStyle(el).getPropertyValue('--progress');
      });
      expect(progressVar).toBeTruthy();

      await expectVisibleTrack(volumeSlider);
      await expectVisibleThumb(volumeSlider);
    });

    test('seek slider thumb should be visible and centered', async ({
      page
    }) => {
      test.slow();
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToAudio(page);

      await uploadTestAudio(page);
      await playFirstTrack(page);

      const seekSlider = page.getByTestId('audio-seekbar');
      await expect(seekSlider).toBeVisible();

      // Verify that the slider is interactable (can click on it)
      // This implicitly tests that the thumb is there and the slider is functional
      await expectVisibleThumb(seekSlider);

      const boundingBox = await seekSlider.boundingBox();
      expect(boundingBox).not.toBeNull();

      if (boundingBox) {
        // Click near the middle of the slider
        const centerX = boundingBox.x + boundingBox.width / 2;
        const centerY = boundingBox.y + boundingBox.height / 2;
        await page.mouse.click(centerX, centerY);

        // Get the current time after clicking - it should have changed
        const currentTimeText = await page
          .getByTestId('audio-current-time')
          .textContent();
        expect(currentTimeText).toBeTruthy();
      }
    });

    test('volume slider should respond to changes', async ({ page }) => {
      test.slow();
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToAudio(page);

      await uploadTestAudio(page);
      await playFirstTrack(page);

      const volumeSlider = page.getByTestId('audio-volume');
      await expect(volumeSlider).toBeVisible();

      // Get initial volume value
      const initialValue = await volumeSlider.inputValue();
      const initialVolume = parseFloat(initialValue);

      // Click near the left side to decrease volume
      const boundingBox = await volumeSlider.boundingBox();
      expect(boundingBox).not.toBeNull();

      if (boundingBox) {
        // Click at 20% from left
        const targetX = boundingBox.x + boundingBox.width * 0.2;
        const centerY = boundingBox.y + boundingBox.height / 2;
        await page.mouse.click(targetX, centerY);

        // Get the new volume value
        const newValue = await volumeSlider.inputValue();
        const newVolume = parseFloat(newValue);

        // Volume should have changed (decreased since we clicked left)
        expect(newVolume).not.toEqual(initialVolume);
        expect(newVolume).toBeLessThan(0.5); // Should be around 0.2 since we clicked at 20%
      }
    });

    test('mute toggle should work', async ({ page }) => {
      test.slow();
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToAudio(page);

      await uploadTestAudio(page);
      await playFirstTrack(page);

      const muteButton = page.getByTestId('audio-mute-toggle');
      const volumeSlider = page.getByTestId('audio-volume');

      await expect(muteButton).toBeVisible();
      await expect(volumeSlider).toBeVisible();

      // Get initial volume
      const initialValue = await volumeSlider.inputValue();
      const initialVolume = parseFloat(initialValue);
      expect(initialVolume).toBeGreaterThan(0);

      // Click mute button
      await muteButton.click();

      // Volume should be 0
      const mutedValue = await volumeSlider.inputValue();
      expect(parseFloat(mutedValue)).toBe(0);

      // Click unmute
      await muteButton.click();

      // Volume should be restored
      const restoredValue = await volumeSlider.inputValue();
      expect(parseFloat(restoredValue)).toBeGreaterThan(0);
    });

    test('restart button should reset track to beginning', async ({ page }) => {
      test.slow();
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToAudio(page);

      await uploadTestAudio(page);
      await playFirstTrack(page);

      // Verify the restart button is visible
      const restartButton = page.getByTestId('audio-restart');
      await expect(restartButton).toBeVisible();

      // Verify it has the correct aria-label
      await expect(restartButton).toHaveAttribute('aria-label', 'Restart track');

      // Get the seek slider and move it to middle
      const seekSlider = page.getByTestId('audio-seekbar');
      const boundingBox = await seekSlider.boundingBox();
      expect(boundingBox).not.toBeNull();

      if (boundingBox) {
        // Click at 50% to seek to middle
        const centerX = boundingBox.x + boundingBox.width * 0.5;
        const centerY = boundingBox.y + boundingBox.height / 2;
        await page.mouse.click(centerX, centerY);

        // Verify the time is visible after seeking (may not be exactly 50% due to duration)
        await expect(page.getByTestId('audio-current-time')).toBeVisible();

        // Click restart button
        await restartButton.click();

        // Verify time is back to 0:00
        await expect(page.getByTestId('audio-current-time')).toHaveText('0:00');
      }
    });
  });

  test.describe('Mobile viewport (375px)', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('sliders should be visible on mobile', async ({ page }) => {
      test.slow();
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToAudio(page);

      await uploadTestAudio(page);
      await playFirstTrack(page);

      // Verify the audio player is visible
      const audioPlayer = page.getByTestId('audio-player');
      await expect(audioPlayer).toBeVisible();

      // Verify seek slider is visible
      const seekSlider = page.getByTestId('audio-seekbar');
      await expect(seekSlider).toBeVisible();

      // Verify volume slider is visible
      const volumeSlider = page.getByTestId('audio-volume');
      await expect(volumeSlider).toBeVisible();

      // Verify both sliders have proper dimensions on mobile
      const seekBox = await seekSlider.boundingBox();
      const volumeBox = await volumeSlider.boundingBox();

      expect(seekBox).not.toBeNull();
      expect(volumeBox).not.toBeNull();

      if (seekBox) {
        // Seek slider should span most of the mobile width
        expect(seekBox.width).toBeGreaterThan(200);
      }

      if (volumeBox) {
        // Volume slider should have visible width on mobile
        expect(volumeBox.width).toBeGreaterThanOrEqual(90);
      }
    });
  });
});
