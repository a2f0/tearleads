import type { TestContext } from '@tearleads/api-test-utils';

let ctx: TestContext | null = null;

export function setSharedTestContext(c: TestContext): void {
  ctx = c;
}

export function getSharedTestContext(): TestContext {
  if (!ctx)
    throw new Error('Test context not initialized — setup.ts must run first');
  return ctx;
}
