import { test, expect, Page } from '@playwright/test';

// Helper to check if viewport is mobile (sidebar hidden at lg breakpoint = 1024px)
function isMobileViewport(page: Page): boolean {
  const viewport = page.viewportSize();
  return (viewport?.width ?? 0) < 1024;
}

// Helper to reset, setup, and unlock the database
async function setupAndUnlockDatabase(page: Page, password = 'testpassword123') {
  const isMobile = isMobileViewport(page);

  if (isMobile) {
    await page.getByTestId('mobile-menu-button').click();
    await page.getByTestId('sqlite-link').click();
  } else {
    const link = page
      .locator('aside nav')
      .getByRole('link', { name: 'SQLite' });
    await link.click();
  }

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
  const isMobile = isMobileViewport(page);

  if (isMobile) {
    await page.getByTestId('mobile-menu-button').click();
    await page.getByTestId('photos-link').click();
  } else {
    const link = page
      .locator('aside nav')
      .getByRole('link', { name: 'Photos' });
    await link.click();
  }
}

// Minimal valid PNG (1x1 transparent pixel) - same format as index.spec.ts
const MINIMAL_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, // bit depth, color type, etc.
  0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
  0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, // compressed data
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND chunk
  0xae, 0x42, 0x60, 0x82
]);

// Helper to upload a single test image and wait for grid to appear
async function uploadTestImage(page: Page) {
  const fileInput = page.getByTestId('dropzone-input');
  await fileInput.setInputFiles({
    name: 'test-image.png',
    mimeType: 'image/png',
    buffer: MINIMAL_PNG
  });

  // Wait for grid to appear (shows when there's at least one photo)
  await expect(page.getByTestId('photos-grid')).toBeVisible({ timeout: 30000 });
}

test.describe('Photos page responsive layout', () => {
  test.describe('Mobile viewport (375px - iPhone)', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('should display photos grid with 3 columns and square aspect ratio on mobile', async ({
      page
    }) => {
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

    test('should display photos grid with 4 columns on tablet (sm breakpoint)', async ({
      page
    }) => {
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToPhotos(page);

      await uploadTestImage(page);

      const grid = page.getByTestId('photos-grid');
      await expect(grid).toBeVisible();

      // At sm breakpoint (640px+), should have 4 columns
      await expect(grid).toHaveClass(/sm:grid-cols-4/);
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
