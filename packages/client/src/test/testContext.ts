import type { TestContext } from '@tearleads/api-test-utils';

let ctx: TestContext | null = null;
let wasAccessed = false;

export function setSharedTestContext(c: TestContext): void {
  ctx = c;
  wasAccessed = false;
}

export function getSharedTestContext(): TestContext {
  wasAccessed = true;
  if (!ctx)
    throw new Error('Test context not initialized — setup.ts must run first');
  return ctx;
}

export function wasSharedTestContextAccessed(): boolean {
  return wasAccessed;
}

export function resetSharedTestContextAccessed(): void {
  wasAccessed = false;
}
