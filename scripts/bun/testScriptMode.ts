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
  const usesBunPerFileRunner = testScript.includes('runBunPerFile.sh');
  if (
    testScript.includes('command -v bun') ||
    ((testScript.includes('bun test') || usesBunPerFileRunner) &&
      testScript.includes('||') &&
      testScript.includes('vitest'))
  ) {
    return 'bun-auto-fallback';
  }
  if (testScript.includes('bun test') || usesBunPerFileRunner) {
    return 'bun-primary';
  }
  if (testScript.includes('vitest')) {
    return 'vitest-primary';
  }
  return 'other';
}
