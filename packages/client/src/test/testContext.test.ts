import type { TestContext } from '@tearleads/api-test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getSharedTestContext,
  resetSharedTestContextAccessed,
  setSharedTestContext,
  wasSharedTestContextAccessed
} from './testContext';

function makeContextStub(): TestContext {
  return {
    pool: {} as TestContext['pool'],
    redis: {} as TestContext['redis'],
    app: {} as TestContext['app'],
    server: {} as TestContext['server'],
    port: 0,
    baseUrl: 'http://localhost:0',
    resetState: async () => {},
    teardown: async () => {}
  };
}

describe('testContext access tracking', () => {
  beforeEach(() => {
    setSharedTestContext(makeContextStub());
    resetSharedTestContextAccessed();
  });

  it('starts as not accessed after setup', () => {
    expect(wasSharedTestContextAccessed()).toBe(false);
  });

  it('marks as accessed when context is requested', () => {
    void getSharedTestContext();
    expect(wasSharedTestContextAccessed()).toBe(true);
  });

  it('can reset access flag between tests', () => {
    void getSharedTestContext();
    expect(wasSharedTestContextAccessed()).toBe(true);
    resetSharedTestContextAccessed();
    expect(wasSharedTestContextAccessed()).toBe(false);
  });
});
