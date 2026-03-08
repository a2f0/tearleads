const FAIL_ON_CONSOLE_PATTERNS = [
  /VFS rematerialization bootstrap failed/i,
  /Initial VFS orchestrator flush failed/i,
  /transport returned invalid hasMore/i,
  /page\.items is undefined/i,
  /can't access property Symbol\.iterator, page\.items is undefined/i
];

export function shouldFailOnConsoleMessage(message: string): boolean {
  for (const pattern of FAIL_ON_CONSOLE_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }
  return false;
}
