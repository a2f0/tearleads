import { describe, expect, it } from 'vitest';
import { parsePushPayload } from './post-crdt-push-parse.js';

function buildValidAclAddOperation(): Record<string, unknown> {
  return {
    opId: 'op-1',
    opType: 'acl_add',
    itemId: 'item-1',
    replicaId: 'client-1',
    writeId: 1,
    occurredAt: '2026-02-16T00:00:00.000Z',
    principalType: 'user',
    principalId: 'user-2',
    accessLevel: 'read'
  };
}

function buildValidLinkAddOperation(): Record<string, unknown> {
  return {
    opId: 'op-1',
    opType: 'link_add',
    itemId: 'child-1',
    replicaId: 'client-1',
    writeId: 1,
    occurredAt: '2026-02-16T00:00:00.000Z',
    parentId: 'parent-1'
  };
}

describe('post-crdt-push-parse', () => {
  describe('parsePushPayload', () => {
    it('rejects non-record payloads', () => {
      expect(parsePushPayload(null)).toEqual({
        ok: false,
        error: 'clientId and operations are required'
      });
    });

    it('rejects invalid client ids', () => {
      expect(
        parsePushPayload({
          clientId: 'bad:client',
          operations: []
        })
      ).toEqual({
        ok: false,
        error:
          'clientId must be non-empty, <=128 chars, and must not contain ":"'
      });
    });

    it('rejects non-array operations', () => {
      expect(
        parsePushPayload({
          clientId: 'client-1',
          operations: 'not-an-array'
        })
      ).toEqual({
        ok: false,
        error: 'operations must be an array'
      });
    });

    it('enforces the max operation count guardrail', () => {
      expect(
        parsePushPayload({
          clientId: 'client-1',
          operations: new Array(501).fill({})
        })
      ).toEqual({
        ok: false,
        error: 'operations exceeds max entries (500)'
      });
    });

    it('parses valid acl operations', () => {
      const result = parsePushPayload({
        clientId: 'client-1',
        operations: [buildValidAclAddOperation()]
      });

      expect(result).toEqual({
        ok: true,
        value: {
          clientId: 'client-1',
          operations: [
            {
              status: 'parsed',
              opId: 'op-1',
              operation: {
                opId: 'op-1',
                opType: 'acl_add',
                itemId: 'item-1',
                replicaId: 'client-1',
                writeId: 1,
                occurredAt: '2026-02-16T00:00:00.000Z',
                principalType: 'user',
                principalId: 'user-2',
                accessLevel: 'read'
              }
            }
          ]
        }
      });
    });

    it('defaults childId for link operations to itemId', () => {
      const result = parsePushPayload({
        clientId: 'client-1',
        operations: [buildValidLinkAddOperation()]
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected parsePushPayload to succeed');
      }

      expect(result.value.operations[0]).toEqual({
        status: 'parsed',
        opId: 'op-1',
        operation: {
          opId: 'op-1',
          opType: 'link_add',
          itemId: 'child-1',
          replicaId: 'client-1',
          writeId: 1,
          occurredAt: '2026-02-16T00:00:00.000Z',
          parentId: 'parent-1',
          childId: 'child-1'
        }
      });
    });

    it('rejects malformed link operations that break graph invariants', () => {
      const result = parsePushPayload({
        clientId: 'client-1',
        operations: [
          {
            ...buildValidLinkAddOperation(),
            childId: 'different-child'
          },
          {
            ...buildValidLinkAddOperation(),
            itemId: 'same-id',
            parentId: 'same-id'
          }
        ]
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected parsePushPayload to succeed');
      }

      expect(result.value.operations).toEqual([
        {
          status: 'invalid',
          opId: 'op-1'
        },
        {
          status: 'invalid',
          opId: 'op-1'
        }
      ]);
    });

    it('rejects operations whose replicaId does not match clientId', () => {
      const result = parsePushPayload({
        clientId: 'client-1',
        operations: [
          {
            ...buildValidAclAddOperation(),
            replicaId: 'client-2'
          }
        ]
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected parsePushPayload to succeed');
      }

      expect(result.value.operations[0]).toEqual({
        status: 'invalid',
        opId: 'op-1'
      });
    });

    it('marks non-record entries with deterministic fallback op ids', () => {
      const result = parsePushPayload({
        clientId: 'client-1',
        operations: [null, buildValidAclAddOperation()]
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected parsePushPayload to succeed');
      }

      expect(result.value.operations[0]).toEqual({
        status: 'invalid',
        opId: 'invalid-0'
      });
      expect(result.value.operations[1]?.status).toBe('parsed');
    });
  });

  describe('encrypted CRDT operations', () => {
    it('parses encrypted ACL operation with all envelope fields', () => {
      const result = parsePushPayload({
        clientId: 'client-1',
        operations: [
          {
            ...buildValidAclAddOperation(),
            encryptedPayload: 'base64-ciphertext',
            keyEpoch: 1,
            encryptionNonce: 'base64-nonce',
            encryptionAad: 'base64-aad',
            encryptionSignature: 'base64-sig'
          }
        ]
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected parsePushPayload to succeed');
      }

      expect(result.value.operations[0]).toEqual({
        status: 'parsed',
        opId: 'op-1',
        operation: {
          opId: 'op-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'client-1',
          writeId: 1,
          occurredAt: '2026-02-16T00:00:00.000Z',
          principalType: 'user',
          principalId: 'user-2',
          accessLevel: 'read',
          encryptedPayload: 'base64-ciphertext',
          keyEpoch: 1,
          encryptionNonce: 'base64-nonce',
          encryptionAad: 'base64-aad',
          encryptionSignature: 'base64-sig'
        }
      });
    });

    it('parses encrypted ACL operation without plaintext ACL fields', () => {
      const result = parsePushPayload({
        clientId: 'client-1',
        operations: [
          {
            opId: 'op-1',
            opType: 'acl_add',
            itemId: 'item-1',
            replicaId: 'client-1',
            writeId: 1,
            occurredAt: '2026-02-16T00:00:00.000Z',
            encryptedPayload: 'base64-ciphertext',
            keyEpoch: 1
          }
        ]
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected parsePushPayload to succeed');
      }

      expect(result.value.operations[0]).toEqual({
        status: 'parsed',
        opId: 'op-1',
        operation: {
          opId: 'op-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'client-1',
          writeId: 1,
          occurredAt: '2026-02-16T00:00:00.000Z',
          encryptedPayload: 'base64-ciphertext',
          keyEpoch: 1
        }
      });
    });

    it('rejects encrypted operation with keyEpoch < 1', () => {
      const result = parsePushPayload({
        clientId: 'client-1',
        operations: [
          {
            ...buildValidAclAddOperation(),
            encryptedPayload: 'base64-ciphertext',
            keyEpoch: 0
          }
        ]
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected parsePushPayload to succeed');
      }

      expect(result.value.operations[0]).toEqual({
        status: 'invalid',
        opId: 'op-1'
      });
    });

    it('rejects encrypted operation with non-numeric keyEpoch', () => {
      const result = parsePushPayload({
        clientId: 'client-1',
        operations: [
          {
            ...buildValidAclAddOperation(),
            encryptedPayload: 'base64-ciphertext',
            keyEpoch: 'not-a-number'
          }
        ]
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected parsePushPayload to succeed');
      }

      expect(result.value.operations[0]).toEqual({
        status: 'invalid',
        opId: 'op-1'
      });
    });

    it('rejects unencrypted ACL operation without plaintext fields', () => {
      const result = parsePushPayload({
        clientId: 'client-1',
        operations: [
          {
            opId: 'op-1',
            opType: 'acl_add',
            itemId: 'item-1',
            replicaId: 'client-1',
            writeId: 1,
            occurredAt: '2026-02-16T00:00:00.000Z'
          }
        ]
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected parsePushPayload to succeed');
      }

      expect(result.value.operations[0]).toEqual({
        status: 'invalid',
        opId: 'op-1'
      });
    });

    it('parses encrypted operation with only required envelope fields', () => {
      const result = parsePushPayload({
        clientId: 'client-1',
        operations: [
          {
            opId: 'op-1',
            opType: 'acl_remove',
            itemId: 'item-1',
            replicaId: 'client-1',
            writeId: 1,
            occurredAt: '2026-02-16T00:00:00.000Z',
            encryptedPayload: 'base64-ciphertext',
            keyEpoch: 5
          }
        ]
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected parsePushPayload to succeed');
      }

      expect(result.value.operations[0]).toEqual({
        status: 'parsed',
        opId: 'op-1',
        operation: {
          opId: 'op-1',
          opType: 'acl_remove',
          itemId: 'item-1',
          replicaId: 'client-1',
          writeId: 1,
          occurredAt: '2026-02-16T00:00:00.000Z',
          encryptedPayload: 'base64-ciphertext',
          keyEpoch: 5
        }
      });
    });
  });
});
