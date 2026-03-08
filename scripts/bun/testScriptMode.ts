export type TestScriptMode =
  | 'none'
  | 'bun-primary'
  | 'bun-auto-fallback'
  | 'vitest-primary'
  | 'other';

export function classifyTestScript(
  testScript: string | undefined
): TestScriptMode {
  if (testScript === undefined) {
    return 'none';
  }
  if (
    testScript.includes('command -v bun') ||
    (testScript.includes('bun test') &&
      testScript.includes('||') &&
      testScript.includes('vitest'))
  ) {
    return 'bun-auto-fallback';
  }
  if (testScript.includes('bun test')) {
    return 'bun-primary';
  }
  if (testScript.includes('vitest')) {
    return 'vitest-primary';
  }
  return 'other';
}
