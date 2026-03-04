export type TestStatus = 'idle' | 'running' | 'success' | 'error';

export interface TestResult {
  status: TestStatus;
  message: string;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
