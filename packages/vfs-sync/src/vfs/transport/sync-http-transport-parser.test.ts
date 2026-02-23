import { describe, expect, it } from 'vitest';
import { parseApiPullResponse } from './sync-http-transport-parser';

function createEncryptedItem(keyEpoch: number): Record<string, unknown> {
  return {
    opId: 'op-1',
    itemId: 'item-1',
    opType: 'acl_add',
    principalType: null,
    principalId: null,
    accessLevel: null,
    parentId: null,
    childId: null,
    actorId: 'user-1',
    sourceTable: 'vfs_acl_entries',
    sourceId: 'row-1',
    occurredAt: new Date('2026-02-21T10:00:00.000Z').toISOString(),
    encryptedPayload: 'base64-ciphertext',
    keyEpoch
  };
}

describe('sync-http-transport parser encrypted envelope keyEpoch', () => {
  it('rejects encrypted envelope with non-safe-integer keyEpoch', () => {
    expect(() =>
      parseApiPullResponse({
        items: [createEncryptedItem(Number.MAX_SAFE_INTEGER + 1)],
        nextCursor: null,
        hasMore: false,
        lastReconciledWriteIds: { 'client-1': 1 }
      })
    ).toThrow(/invalid encrypted envelope at items\[0\]/);
  });

  it('accepts encrypted envelope with safe-integer keyEpoch', () => {
    const response = parseApiPullResponse({
      items: [createEncryptedItem(3)],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: { 'client-1': 1 }
    });

    expect(response.items[0]?.keyEpoch).toBe(3);
    expect(response.items[0]?.encryptedPayload).toBe('base64-ciphertext');
  });
});
