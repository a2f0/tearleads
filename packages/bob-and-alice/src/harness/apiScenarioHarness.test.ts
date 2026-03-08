import { describe, expect, it } from 'vitest';
import { isRetryableWriteValidationError } from './apiScenarioHarness.js';

describe('isRetryableWriteValidationError', () => {
  it('retries share requests with transient required-field validation failures', () => {
    expect(
      isRetryableWriteValidationError(
        '/vfs/items/item-1/shares',
        { method: 'POST' },
        400,
        '{"error":"shareType, targetId, and permissionLevel are required"}'
      )
    ).toBe(true);
  });

  it('retries register requests with transient required-field validation failures', () => {
    expect(
      isRetryableWriteValidationError(
        '/vfs/register',
        { method: 'POST' },
        400,
        '{"error":"id, objectType, and encryptedSessionKey are required"}'
      )
    ).toBe(true);
  });

  it('does not retry unrelated request failures', () => {
    expect(
      isRetryableWriteValidationError(
        '/vfs/register',
        { method: 'GET' },
        400,
        '{"error":"id, objectType, and encryptedSessionKey are required"}'
      )
    ).toBe(false);

    expect(
      isRetryableWriteValidationError(
        '/vfs/items/item-1/shares',
        { method: 'POST' },
        500,
        '{"error":"shareType, targetId, and permissionLevel are required"}'
      )
    ).toBe(false);

    expect(
      isRetryableWriteValidationError(
        '/vfs/register',
        { method: 'POST' },
        400,
        '{"error":"unexpected payload"}'
      )
    ).toBe(false);
  });
});
