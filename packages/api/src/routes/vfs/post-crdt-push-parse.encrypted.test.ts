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

describe('post-crdt-push-parse encrypted envelope', () => {
  it('parses encrypted ACL remove operation with all envelope fields', () => {
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
        opType: 'acl_remove',
        itemId: 'item-1',
        replicaId: 'client-1',
        writeId: 1,
        occurredAt: '2026-02-16T00:00:00.000Z',
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
        encryptedPayload: 'base64-ciphertext',
        keyEpoch: 1,
        encryptionNonce: 'base64-nonce',
        encryptionAad: 'base64-aad',
        encryptionSignature: 'base64-sig'
      }
    });
  });

  it('rejects encrypted operation with invalid keyEpoch', () => {
    const result = parsePushPayload({
      clientId: 'client-1',
      operations: [
        {
          ...buildValidAclAddOperation(),
          encryptedPayload: 'base64-ciphertext',
          keyEpoch: 0
        },
        {
          ...buildValidAclAddOperation(),
          opId: 'op-2',
          encryptedPayload: 'base64-ciphertext',
          keyEpoch: 'not-a-number'
        },
        {
          ...buildValidAclAddOperation(),
          opId: 'op-3',
          encryptedPayload: 'base64-ciphertext',
          keyEpoch: 1.5
        }
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected parsePushPayload to succeed');
    }

    expect(result.value.operations).toEqual([
      { status: 'invalid', opId: 'op-1' },
      { status: 'invalid', opId: 'op-2' },
      { status: 'invalid', opId: 'op-3' }
    ]);
  });

  it('parses encrypted link operation without plaintext link fields', () => {
    const result = parsePushPayload({
      clientId: 'client-1',
      operations: [
        {
          opId: 'op-link-1',
          opType: 'link_add',
          itemId: 'item-1',
          replicaId: 'client-1',
          writeId: 1,
          occurredAt: '2026-02-16T00:00:00.000Z',
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
      opId: 'op-link-1',
      operation: {
        opId: 'op-link-1',
        opType: 'link_add',
        itemId: 'item-1',
        replicaId: 'client-1',
        writeId: 1,
        occurredAt: '2026-02-16T00:00:00.000Z',
        encryptedPayload: 'base64-ciphertext',
        keyEpoch: 1,
        encryptionNonce: 'base64-nonce',
        encryptionAad: 'base64-aad',
        encryptionSignature: 'base64-sig'
      }
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

  it('rejects encrypted operation missing required envelope metadata', () => {
    const result = parsePushPayload({
      clientId: 'client-1',
      operations: [
        {
          opId: 'op-missing-metadata',
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
      status: 'invalid',
      opId: 'op-missing-metadata'
    });
  });

  it('rejects encrypted ACL operation that mixes plaintext ACL fields', () => {
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
      status: 'invalid',
      opId: 'op-1'
    });
  });

  it('rejects encrypted link operation that mixes plaintext link fields', () => {
    const result = parsePushPayload({
      clientId: 'client-1',
      operations: [
        {
          opId: 'op-link-1',
          opType: 'link_add',
          itemId: 'item-1',
          replicaId: 'client-1',
          writeId: 1,
          occurredAt: '2026-02-16T00:00:00.000Z',
          encryptedPayload: 'base64-ciphertext',
          keyEpoch: 1,
          encryptionNonce: 'base64-nonce',
          encryptionAad: 'base64-aad',
          encryptionSignature: 'base64-sig',
          parentId: 'folder-1',
          childId: 'item-1'
        }
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected parsePushPayload to succeed');
    }

    expect(result.value.operations[0]).toEqual({
      status: 'invalid',
      opId: 'op-link-1'
    });
  });
});
