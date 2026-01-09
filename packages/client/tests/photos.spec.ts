import { test, expect, Page } from '@playwright/test';
import { MINIMAL_PNG } from './test-utils';

// Helper to check if viewport is mobile (sidebar hidden at lg breakpoint = 1024px)
function isMobileViewport(page: Page): boolean {
  const viewport = page.viewportSize();
  return (viewport?.width ?? 0) < 1024;
}

// Helper to navigate to a page, handling mobile/desktop differences
async function navigateToPage(page: Page, pageName: 'SQLite' | 'Photos') {
  const isMobile = isMobileViewport(page);

  if (isMobile) {
    await page.getByTestId('mobile-menu-button').click();
    // Scope to mobile menu dropdown to avoid strict mode violation
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

// Helper to navigate to Photos page
async function navigateToPhotos(page: Page) {
  await navigateToPage(page, 'Photos');
}

// Helper to upload a single test image and wait for grid to appear
async function uploadTestImage(page: Page) {
  // Wait for the dropzone to be ready
  const fileInput = page.getByTestId('dropzone-input');
  await expect(fileInput).toBeAttached({ timeout: 10000 });

  await fileInput.setInputFiles({
    name: 'test-image.png',
    mimeType: 'image/png',
    buffer: MINIMAL_PNG
  });

  // Wait for either the grid or an error to appear
  // In CI, file processing can be slower
  await expect(page.getByTestId('photos-grid')).toBeVisible({ timeout: 60000 });
}

test.describe('Photos page responsive layout', () => {
  test.describe('Mobile viewport (375px - iPhone)', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    // This test involves database setup, file upload, and thumbnail generation
    // which can be slow in CI environments
    test('should display photos grid with 3 columns and square aspect ratio on mobile', async ({
      page
    }) => {
      test.slow(); // Triple the default timeout
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToPhotos(page);

      // Upload a test image to trigger grid display
      await uploadTestImage(page);

      // Verify the grid is visible
      const grid = page.getByTestId('photos-grid');
      await expect(grid).toBeVisible();

      // Verify grid has grid-cols-3 class (3 columns on mobile)
      await expect(grid).toHaveClass(/grid-cols-3/);

      // Verify at least one photo item exists
      const photos = grid.locator('[role="button"]');
      await expect(photos.first()).toBeVisible();

      // Verify square aspect ratio
      const firstPhoto = photos.first();
      const boundingBox = await firstPhoto.boundingBox();
      expect(boundingBox).not.toBeNull();

      if (boundingBox) {
        // Aspect ratio should be approximately 1:1 (square)
        const aspectRatio = boundingBox.width / boundingBox.height;
        expect(aspectRatio).toBeCloseTo(1, 1);

        // On mobile with 3 columns, photos should fill ~1/3 of container width
        // Container is 375px - 32px padding = 343px, with 8px gaps = ~105px per photo
        expect(boundingBox.width).toBeGreaterThan(80);
        expect(boundingBox.width).toBeLessThan(140);
      }
    });
  });

  test.describe('Tablet viewport (768px - iPad)', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('should display photos grid with 5 columns on tablet (md breakpoint)', async ({
      page
    }) => {
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToPhotos(page);

      await uploadTestImage(page);

      const grid = page.getByTestId('photos-grid');
      await expect(grid).toBeVisible();

      // At md breakpoint (768px+), the grid should compute to 5 columns
      await expect(grid).toHaveCSS(
        'grid-template-columns',
        /repeat\(5,.*\)|(\d+(\.\d+)?px\s+){4}\d+(\.\d+)?px/
      );
    });
  });

  test.describe('Desktop viewport (1280px)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('should display photos grid with responsive column classes on desktop', async ({
      page
    }) => {
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToPhotos(page);

      await uploadTestImage(page);

      const grid = page.getByTestId('photos-grid');
      await expect(grid).toBeVisible();

      // Should have all responsive classes
      await expect(grid).toHaveClass(/grid-cols-3/);
      await expect(grid).toHaveClass(/sm:grid-cols-4/);
      await expect(grid).toHaveClass(/md:grid-cols-5/);
      await expect(grid).toHaveClass(/lg:grid-cols-6/);
    });

    test('photos should be smaller on desktop due to more columns', async ({
      page
    }) => {
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToPhotos(page);

      await uploadTestImage(page);

      const grid = page.getByTestId('photos-grid');
      const firstPhoto = grid.locator('[role="button"]').first();

      const boundingBox = await firstPhoto.boundingBox();
      expect(boundingBox).not.toBeNull();

      if (boundingBox) {
        // On desktop with 6 columns, photos should be smaller
        // Container is constrained, so photos should be less than 250px wide
        expect(boundingBox.width).toBeLessThan(250);
        // Still should be square
        const aspectRatio = boundingBox.width / boundingBox.height;
        expect(aspectRatio).toBeCloseTo(1, 1);
      }
    });
  });
});
