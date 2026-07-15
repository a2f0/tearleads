// Shared between mswServer.ts (records) and happydom.ts (asserts at end of run).
//
// This module must stay dependency-free. happydom.ts is the test preload, so
// anything it reaches transitively is evaluated before every test file — and
// importing mswServer from there would call server.listen() for all 265 files
// rather than only the ~20 that opt in.
const unhandledRequests: string[] = [];

export function recordUnhandledRequest(description: string): void {
  unhandledRequests.push(description);
}

export function takeUnhandledRequests(): string[] {
  return unhandledRequests.splice(0, unhandledRequests.length);
}
