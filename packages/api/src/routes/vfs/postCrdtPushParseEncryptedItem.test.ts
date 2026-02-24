import { describe, expect, it } from 'vitest';
import { parsePushPayload } from './post-crdt-push-parse.js';

describe('post-crdt-push-parse encrypted item operations', () => {
  it('parses encrypted item_upsert operation with full envelope', () => {
    const result = parsePushPayload({
      clientId: 'client-1',
      operations: [
        {
          opId: 'op-upsert-1',
          opType: 'item_upsert',
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
      opId: 'op-upsert-1',
      operation: {
        opId: 'op-upsert-1',
        opType: 'item_upsert',
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

  it('rejects item_upsert without encrypted payload', () => {
    const result = parsePushPayload({
      clientId: 'client-1',
      operations: [
        {
          opId: 'op-upsert-plain',
          opType: 'item_upsert',
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
      opId: 'op-upsert-plain'
    });
  });

  it('parses item_delete without encrypted payload', () => {
    const result = parsePushPayload({
      clientId: 'client-1',
      operations: [
        {
          opId: 'op-delete-1',
          opType: 'item_delete',
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
      status: 'parsed',
      opId: 'op-delete-1',
      operation: {
        opId: 'op-delete-1',
        opType: 'item_delete',
        itemId: 'item-1',
        replicaId: 'client-1',
        writeId: 1,
        occurredAt: '2026-02-16T00:00:00.000Z'
      }
    });
  });

  it('rejects item_delete with encrypted payload', () => {
    const result = parsePushPayload({
      clientId: 'client-1',
      operations: [
        {
          opId: 'op-delete-enc',
          opType: 'item_delete',
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
      status: 'invalid',
      opId: 'op-delete-enc'
    });
  });

  it('rejects item_upsert that includes ACL fields', () => {
    const result = parsePushPayload({
      clientId: 'client-1',
      operations: [
        {
          opId: 'op-upsert-acl',
          opType: 'item_upsert',
          itemId: 'item-1',
          replicaId: 'client-1',
          writeId: 1,
          occurredAt: '2026-02-16T00:00:00.000Z',
          encryptedPayload: 'base64-ciphertext',
          keyEpoch: 1,
          encryptionNonce: 'base64-nonce',
          encryptionAad: 'base64-aad',
          encryptionSignature: 'base64-sig',
          principalType: 'user',
          principalId: 'user-2',
          accessLevel: 'read'
        }
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected parsePushPayload to succeed');
    }

    expect(result.value.operations[0]).toEqual({
      status: 'invalid',
      opId: 'op-upsert-acl'
    });
  });

  it('rejects item_upsert that includes link fields', () => {
    const result = parsePushPayload({
      clientId: 'client-1',
      operations: [
        {
          opId: 'op-upsert-link',
          opType: 'item_upsert',
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
      opId: 'op-upsert-link'
    });
  });

  it('rejects item_delete that includes ACL fields', () => {
    const result = parsePushPayload({
      clientId: 'client-1',
      operations: [
        {
          opId: 'op-delete-acl',
          opType: 'item_delete',
          itemId: 'item-1',
          replicaId: 'client-1',
          writeId: 1,
          occurredAt: '2026-02-16T00:00:00.000Z',
          principalType: 'user'
        }
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected parsePushPayload to succeed');
    }

    expect(result.value.operations[0]).toEqual({
      status: 'invalid',
      opId: 'op-delete-acl'
    });
  });

  it('rejects item_delete that includes link fields', () => {
    const result = parsePushPayload({
      clientId: 'client-1',
      operations: [
        {
          opId: 'op-delete-link',
          opType: 'item_delete',
          itemId: 'item-1',
          replicaId: 'client-1',
          writeId: 1,
          occurredAt: '2026-02-16T00:00:00.000Z',
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
      opId: 'op-delete-link'
    });
  });
});
