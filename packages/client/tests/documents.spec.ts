import { test, expect, Page } from '@playwright/test';

// Minimal valid PDF for testing
// This is a valid PDF with minimal content that pdf.js can parse
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\n' +
    'xref\n' +
    '0 4\n' +
    '0000000000 65535 f \n' +
    '0000000009 00000 n \n' +
    '0000000058 00000 n \n' +
    '0000000115 00000 n \n' +
    'trailer << /Size 4 /Root 1 0 R >>\n' +
    'startxref\n' +
    '190\n' +
    '%%EOF',
  'utf-8'
);

// Helper to check if viewport is mobile (sidebar hidden at lg breakpoint = 1024px)
function isMobileViewport(page: Page): boolean {
  const viewport = page.viewportSize();
  return (viewport?.width ?? 0) < 1024;
}

// Helper to navigate to a page, handling mobile/desktop differences
async function navigateToPage(
  page: Page,
  pageName: 'SQLite' | 'Documents'
): Promise<void> {
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
async function setupAndUnlockDatabase(
  page: Page,
  password = 'testpassword123'
): Promise<void> {
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

// Helper to navigate to Documents page
async function navigateToDocuments(page: Page): Promise<void> {
  await navigateToPage(page, 'Documents');
}

// Helper to upload a test PDF and wait for it to appear in the list
async function uploadTestPdf(page: Page): Promise<void> {
  // Wait for the dropzone to be ready
  const fileInput = page.getByTestId('dropzone-input');
  await expect(fileInput).toBeAttached({ timeout: 10000 });

  await fileInput.setInputFiles({
    name: 'test-document.pdf',
    mimeType: 'application/pdf',
    buffer: MINIMAL_PDF
  });

  // Wait for "1 document" text which confirms upload completed
  await expect(page.getByText('1 document')).toBeVisible({ timeout: 60000 });

  // Now the documents list should be visible
  await expect(page.getByTestId('documents-list')).toBeVisible();
}

test.describe('Document direct URL navigation', () => {
  test.describe('Desktop viewport', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('should load document detail page when navigating directly to /documents/:id', async ({
      page
    }) => {
      test.slow(); // File upload and PDF loading can be slow in CI

      // Step 1: Set up database and upload a document
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToDocuments(page);
      await uploadTestPdf(page);

      // Step 2: Click on the document to navigate to detail page and capture the ID
      await page.getByText('test-document.pdf').click();

      // Wait for the detail page to load - use the document title heading specifically
      await expect(page.getByRole('heading', { name: 'test-document.pdf' })).toBeVisible({
        timeout: 10000
      });

      // Capture the document ID from the URL
      const url = page.url();
      const documentId = url.split('/documents/')[1];
      expect(documentId).toBeTruthy();

      // Step 3: Navigate directly to the document URL (simulating page refresh or direct link)
      await page.goto(`/documents/${documentId}`);

      // Step 4: Verify the document loads correctly
      // The page should show inline unlock first since we're on a fresh page load
      await expect(
        page.getByText(/Database is locked\. Enter your password to view this document\./i)
      ).toBeVisible({ timeout: 10000 });

      // Unlock the database using inline unlock component
      await page.getByTestId('inline-unlock-password').fill('testpassword123');
      await page.getByTestId('inline-unlock-button').click();

      // Wait for the document title to appear
      await expect(page.getByRole('heading', { name: 'test-document.pdf' })).toBeVisible({
        timeout: 10000
      });

      // Wait for either PDF to load or error to appear
      const pdfViewer = page.getByTestId('pdf-viewer');
      const pdfLoading = page.getByTestId('pdf-loading');
      const pdfError = page.getByText(/Unexpected server response.*while retrieving PDF/i);

      // First wait for some state to appear
      await expect(pdfViewer.or(pdfLoading).or(pdfError)).toBeVisible({
        timeout: 30000
      });

      // Verify no PDF retrieval error occurred (this catches the race condition)
      await expect(pdfError).not.toBeVisible();

      // If loading, wait for viewer to appear
      if (await pdfLoading.isVisible()) {
        await expect(pdfViewer).toBeVisible({ timeout: 30000 });
      }

      // Verify Document Details section is visible
      await expect(page.getByText('Document Details')).toBeVisible();
      await expect(page.getByText('application/pdf')).toBeVisible();
    });

    test('should handle direct navigation to non-existent document', async ({
      page
    }) => {
      // First set up and unlock database, then navigate to non-existent document
      await page.goto('/');
      await setupAndUnlockDatabase(page);

      // Navigate directly to a non-existent document
      await page.goto('/documents/non-existent-id');

      // The inline unlock will appear since page.goto reloads the page
      await expect(
        page.getByText(/Database is locked\. Enter your password to view this document\./i)
      ).toBeVisible({ timeout: 10000 });

      // Unlock the database
      await page.getByTestId('inline-unlock-password').fill('testpassword123');
      await page.getByTestId('inline-unlock-button').click();

      // After unlock, should show document not found error
      await expect(page.getByText('Document not found')).toBeVisible({
        timeout: 10000
      });
    });
  });

  test.describe('Mobile viewport (375px)', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('should load document detail page on mobile when navigating directly', async ({
      page
    }) => {
      test.slow();

      // Set up database and upload a document
      await page.goto('/');
      await setupAndUnlockDatabase(page);
      await navigateToDocuments(page);
      await uploadTestPdf(page);

      // Click on the document to navigate to detail page
      await page.getByText('test-document.pdf').click();

      // Wait for detail page and capture ID
      await expect(page.getByRole('heading', { name: 'test-document.pdf' })).toBeVisible({
        timeout: 10000
      });
      const url = page.url();
      const documentId = url.split('/documents/')[1];

      // Navigate directly to the document URL
      await page.goto(`/documents/${documentId}`);

      // Unlock the database
      await expect(
        page.getByText(/Database is locked\. Enter your password to view this document\./i)
      ).toBeVisible({ timeout: 10000 });
      await page.getByTestId('inline-unlock-password').fill('testpassword123');
      await page.getByTestId('inline-unlock-button').click();

      // Verify document loads
      await expect(page.getByRole('heading', { name: 'test-document.pdf' })).toBeVisible({
        timeout: 10000
      });

      // Wait for either PDF to load or error to appear
      const pdfViewer = page.getByTestId('pdf-viewer');
      const pdfLoading = page.getByTestId('pdf-loading');
      const pdfError = page.getByText(/Unexpected server response.*while retrieving PDF/i);

      // First wait for some state to appear
      await expect(pdfViewer.or(pdfLoading).or(pdfError)).toBeVisible({
        timeout: 30000
      });

      // Verify no PDF retrieval error occurred (this catches the race condition)
      await expect(pdfError).not.toBeVisible();

      // If loading, wait for viewer to appear
      if (await pdfLoading.isVisible()) {
        await expect(pdfViewer).toBeVisible({ timeout: 30000 });
      }
    });
  });
});
