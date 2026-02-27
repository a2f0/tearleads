import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

const TEST_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;

test.beforeEach(async ({ page }) => {
  await clearOriginStorage(page);
});

async function setupAndUnlockDatabase(
  page: Page,
  password = TEST_PASSWORD
): Promise<void> {
  await page.goto('/sqlite');
  await page.getByTestId('db-reset-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
    timeout: DB_OPERATION_TIMEOUT
  });
  await page.getByTestId('db-password-input').fill(password);
  await page.getByTestId('db-setup-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
    timeout: DB_OPERATION_TIMEOUT
  });
}

// Google Contacts CSV format with all columns
const GOOGLE_CONTACTS_HEADERS = [
  'First Name',
  'Middle Name',
  'Last Name',
  'Phonetic First Name',
  'Phonetic Middle Name',
  'Phonetic Last Name',
  'Name Prefix',
  'Name Suffix',
  'Nickname',
  'File As',
  'Organization Name',
  'Organization Title',
  'Organization Department',
  'Birthday',
  'Notes',
  'Photo',
  'Labels',
  'E-mail 1 - Label',
  'E-mail 1 - Value',
  'E-mail 2 - Label',
  'E-mail 2 - Value',
  'Phone 1 - Label',
  'Phone 1 - Value',
  'Phone 2 - Label',
  'Phone 2 - Value',
  'Phone 3 - Label',
  'Phone 3 - Value',
  'Address 1 - Label',
  'Address 1 - Formatted',
  'Address 1 - Street',
  'Address 1 - City',
  'Address 1 - PO Box',
  'Address 1 - Region',
  'Address 1 - Postal Code',
  'Address 1 - Country',
  'Address 1 - Extended Address',
  'Website 1 - Label',
  'Website 1 - Value'
];

// Sample data row matching Google Contacts format
const SAMPLE_DATA_ROW = [
  'John', // First Name
  'Michael', // Middle Name
  'Doe', // Last Name
  '', // Phonetic First Name
  '', // Phonetic Middle Name
  '', // Phonetic Last Name
  'Mr.', // Name Prefix
  'Jr.', // Name Suffix
  'Johnny', // Nickname
  '', // File As
  'Acme Corp', // Organization Name
  'Software Engineer', // Organization Title
  'Engineering', // Organization Department
  '1990-01-15', // Birthday
  'Test contact for CSV import', // Notes
  '', // Photo
  '* myContacts', // Labels
  'Work', // E-mail 1 - Label
  'john.doe@acme.com', // E-mail 1 - Value
  'Personal', // E-mail 2 - Label
  'john.doe@gmail.com', // E-mail 2 - Value
  'Mobile', // Phone 1 - Label
  '+1 555-123-4567', // Phone 1 - Value
  'Work', // Phone 2 - Label
  '+1 555-987-6543', // Phone 2 - Value
  'Home', // Phone 3 - Label
  '+1 555-111-2222', // Phone 3 - Value
  'Home', // Address 1 - Label
  '123 Main St, Anytown, CA 90210', // Address 1 - Formatted
  '123 Main St', // Address 1 - Street
  'Anytown', // Address 1 - City
  '', // Address 1 - PO Box
  'CA', // Address 1 - Region
  '90210', // Address 1 - Postal Code
  'USA', // Address 1 - Country
  '', // Address 1 - Extended Address
  'Work', // Website 1 - Label
  'https://acme.com' // Website 1 - Value
];

function createGoogleContactsCsv(): string {
  const escape = (val: string) =>
    val.includes(',') || val.includes('"') || val.includes('\n')
      ? '"' + val.replace(/"/g, '""') + '"'
      : val;
  const headerLine = GOOGLE_CONTACTS_HEADERS.map(escape).join(',');
  const dataLine = SAMPLE_DATA_ROW.map(escape).join(',');
  return headerLine + '\n' + dataLine;
}

async function unlockIfNeeded(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');

  // Check if inline unlock component appears
  const inlineUnlock = page.getByTestId('inline-unlock');
  try {
    await expect(inlineUnlock).toBeVisible({ timeout: 3000 });
  } catch {
    return; // Not locked
  }

  // Fill password and unlock
  const passwordInput = page.getByTestId('inline-unlock-password');
  await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
  await passwordInput.fill(TEST_PASSWORD);

  const unlockButton = page.getByTestId('inline-unlock-button');
  await expect(unlockButton).toBeEnabled({ timeout: 5000 });
  await unlockButton.click();

  await expect(inlineUnlock).not.toBeVisible({ timeout: DB_OPERATION_TIMEOUT });
}

test.describe('Contacts CSV Import', () => {
  test('field mapper should be scrollable with many columns', async ({
    page
  }) => {
    // Use a smaller viewport to ensure scrolling is needed
    await page.setViewportSize({ width: 1280, height: 600 });

    await setupAndUnlockDatabase(page);

    // Navigate to contacts page
    await page.goto('/contacts');
    await unlockIfNeeded(page);
    await expect(page.getByText('Import CSV')).toBeVisible({ timeout: 10000 });

    // Upload the Google Contacts format CSV
    const csvContent = createGoogleContactsCsv();
    const fileInput = page.getByTestId('dropzone-input');
    await fileInput.setInputFiles({
      name: 'google-contacts.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent)
    });

    // Wait for column mapper to appear
    await expect(page.getByText('Map CSV Columns')).toBeVisible({
      timeout: 5000
    });

    // The column mapper content is extensive with many fields - verify key sections loaded
    await expect(
      page.getByRole('heading', { name: 'CSV Columns', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Contact Fields' })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Email' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Phone' })).toBeVisible();

    // Verify the Import button exists (at the bottom of the column mapper)
    const importButton = page.getByRole('button', { name: /Import \d+ Contact/ });

    // The Import button should be scrollable into view
    await importButton.scrollIntoViewIfNeeded();
    await expect(importButton).toBeVisible();

    // Verify the button is clickable (not hidden or clipped)
    await expect(importButton).toBeEnabled();
  });
});
