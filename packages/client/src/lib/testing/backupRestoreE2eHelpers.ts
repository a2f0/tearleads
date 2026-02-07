type EvaluateCallback = (route: string) => void;

interface BackupTestLocator {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  textContent(): Promise<string | null>;
}

interface BackupTestPage {
  evaluate(callback: EvaluateCallback, route: string): Promise<void>;
  waitForURL?(url: string): Promise<void>;
  getByTestId(testId: string): BackupTestLocator;
}

export const TEST_PASSWORD = 'testpassword123';
export const BACKUP_PASSWORD = 'testpassword123';
export const DB_OPERATION_TIMEOUT = 15000;
export const BACKUP_TIMEOUT = 30000;

export async function navigateInApp(
  page: BackupTestPage,
  path: string,
  waitForUrl = false
): Promise<void> {
  await page.evaluate((route) => {
    window.history.pushState({}, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

  if (waitForUrl && page.waitForURL) {
    await page.waitForURL(`**${path}`);
  }
}

export async function setupDatabaseForBackup(
  page: BackupTestPage,
  navigate: (path: string) => Promise<void>,
  password = TEST_PASSWORD
): Promise<void> {
  await navigate('/sqlite');

  await page.getByTestId('db-reset-button').click();
  await page.getByTestId('db-password-input').fill(password);
  await page.getByTestId('db-setup-button').click();
}

export async function writeDatabaseTestData(
  page: BackupTestPage
): Promise<string | null> {
  await page.getByTestId('db-write-button').click();
  return page.getByTestId('db-test-data').textContent();
}
