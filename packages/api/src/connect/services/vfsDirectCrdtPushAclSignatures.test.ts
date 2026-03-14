import {
  generateKeyPair,
  serializeKeyPair,
  signAclOperation,
  type VfsCrdtPushOperation
} from '@tearleads/shared';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { verifyAclPushOperationSignature } from './vfsDirectCrdtPushAclSignatures.js';

function createQueryResult<T extends QueryResultRow>(
  rows: T[] = [],
  rowCount?: number
): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rowCount ?? rows.length,
    oid: 0,
    rows,
    fields: []
  };
}

function createAclOperation(
  overrides: Partial<VfsCrdtPushOperation> = {}
): VfsCrdtPushOperation {
  return {
    opId: 'op-1',
    opType: 'acl_add',
    itemId: 'item-1',
    replicaId: 'desktop',
    writeId: 1,
    occurredAt: '2026-02-16T00:00:00.000Z',
    principalType: 'user',
    principalId: 'user-2',
    accessLevel: 'read',
    ...overrides
  };
}

describe('verifyAclPushOperationSignature', () => {
  it('rejects ACL operations without an operationSignature', async () => {
    const queryMock = vi.fn();

    const result = await verifyAclPushOperationSignature({
      actorId: 'user-1',
      cachedPublicSigningKeys: new Map(),
      operation: createAclOperation(),
      runQuery: queryMock
    });

    expect(result).toEqual({
      ok: false,
      reason: 'acl_signature_missing'
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects ACL operations with invalid signatures', async () => {
    const keyPair = generateKeyPair();
    const serializedKeyPair = serializeKeyPair(keyPair);
    const queryMock = vi
      .fn()
      .mockResolvedValue(
        createQueryResult([
          { public_signing_key: serializedKeyPair.ed25519PublicKey }
        ])
      );

    const result = await verifyAclPushOperationSignature({
      actorId: 'user-1',
      cachedPublicSigningKeys: new Map(),
      operation: createAclOperation({
        operationSignature: 'invalid-signature'
      }),
      runQuery: queryMock
    });

    expect(result).toEqual({
      ok: false,
      reason: 'acl_signature_invalid'
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('verifies signatures against the actor public signing key and caches it', async () => {
    const keyPair = generateKeyPair();
    const serializedKeyPair = serializeKeyPair(keyPair);
    const operation = createAclOperation();
    const cachedPublicSigningKeys = new Map<string, Uint8Array | null>();
    const queryMock = vi
      .fn()
      .mockResolvedValue(
        createQueryResult([
          { public_signing_key: serializedKeyPair.ed25519PublicKey }
        ])
      );

    const signature = signAclOperation(
      {
        opId: operation.opId,
        opType: 'acl_add',
        itemId: operation.itemId,
        replicaId: operation.replicaId,
        writeId: operation.writeId,
        occurredAt: operation.occurredAt,
        principalType: operation.principalType ?? 'user',
        principalId: operation.principalId ?? '',
        accessLevel: operation.accessLevel ?? ''
      },
      keyPair.ed25519PrivateKey
    );

    await expect(
      verifyAclPushOperationSignature({
        actorId: 'user-1',
        cachedPublicSigningKeys,
        operation: {
          ...operation,
          operationSignature: signature
        },
        runQuery: queryMock
      })
    ).resolves.toEqual({ ok: true });

    await expect(
      verifyAclPushOperationSignature({
        actorId: 'user-1',
        cachedPublicSigningKeys,
        operation: {
          ...operation,
          opId: 'op-2',
          operationSignature: signAclOperation(
            {
              opId: 'op-2',
              opType: 'acl_add',
              itemId: operation.itemId,
              replicaId: operation.replicaId,
              writeId: operation.writeId,
              occurredAt: operation.occurredAt,
              principalType: operation.principalType ?? 'user',
              principalId: operation.principalId ?? '',
              accessLevel: operation.accessLevel ?? ''
            },
            keyPair.ed25519PrivateKey
          )
        },
        runQuery: queryMock
      })
    ).resolves.toEqual({ ok: true });

    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
