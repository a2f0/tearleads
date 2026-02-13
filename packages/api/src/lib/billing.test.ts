import { describe, expect, it } from 'vitest';
import { buildRevenueCatAppUserId } from './billing.js';

describe('buildRevenueCatAppUserId', () => {
  it('builds an org-scoped RevenueCat app user id', () => {
    expect(buildRevenueCatAppUserId('org-123')).toBe('org:org-123');
  });
});
