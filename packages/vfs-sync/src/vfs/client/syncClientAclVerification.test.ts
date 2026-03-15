import type { VfsCrdtSyncItem } from '@tearleads/shared';
import {
  bytesToBase64,
  generateKeyPair,
  signAclOperation
} from '@tearleads/shared';
import { describe, expect, it } from 'vitest';
import { verifyPulledAclItemSignature } from './syncClientAclVerification.js';

function makeSignedAclItem(
  overrides: Partial<VfsCrdtSyncItem> & {
    replicaId?: string;
    writeId?: number;
  } = {}
): VfsCrdtSyncItem {
  const keys = generateKeyPair();
  const replicaId = overrides.replicaId ?? 'desktop';
  const writeId = overrides.writeId ?? 1;
  const opId = overrides.opId ?? 'op-1';
  const opType = overrides.opType ?? 'acl_add';
  const itemId = overrides.itemId ?? 'item-1';
  const principalType = overrides.principalType ?? 'user';
  const principalId = overrides.principalId ?? 'user-2';
  const accessLevel =
    opType === 'acl_add' ? (overrides.accessLevel ?? 'write') : null;
  const occurredAt = overrides.occurredAt ?? '2026-03-14T00:00:00.000Z';
  const actorId = overrides.actorId ?? 'user-1';

  const signature = signAclOperation(
    {
      opId,
      opType,
      itemId,
      replicaId,
      writeId,
      occurredAt,
      principalType,
      principalId: principalId ?? '',
      accessLevel: opType === 'acl_add' ? (accessLevel ?? '') : ''
    },
    keys.ed25519PrivateKey
  );

  return {
    opId,
    itemId,
    opType: opType as VfsCrdtSyncItem['opType'],
    principalType: principalType as VfsCrdtSyncItem['principalType'],
    principalId,
    accessLevel: accessLevel as VfsCrdtSyncItem['accessLevel'],
    parentId: null,
    childId: null,
    actorId,
    sourceTable: 'vfs_crdt_client_push',
    sourceId: `${actorId}:${replicaId}:${writeId}:${opId}`,
    occurredAt,
    operationSignature: signature,
    actorSigningPublicKey: bytesToBase64(keys.ed25519PublicKey)
  };
}

describe('verifyPulledAclItemSignature', () => {
  it('verifies a valid signed acl_add item', () => {
    const result = verifyPulledAclItemSignature(makeSignedAclItem());
    expect(result).toEqual({ verified: true });
  });

  it('verifies a valid signed acl_remove item', () => {
    const result = verifyPulledAclItemSignature(
      makeSignedAclItem({ opType: 'acl_remove' })
    );
    expect(result).toEqual({ verified: true });
  });

  it('passes non-ACL operations without verification', () => {
    const item = makeSignedAclItem();
    item.opType = 'link_add';
    expect(verifyPulledAclItemSignature(item)).toEqual({ verified: true });
  });

  it('passes unsigned ACL operations', () => {
    const item = makeSignedAclItem();
    item.operationSignature = null;
    expect(verifyPulledAclItemSignature(item)).toEqual({ verified: true });
  });

  it('fails when actorSigningPublicKey is missing', () => {
    const item = makeSignedAclItem();
    item.actorSigningPublicKey = null;
    const result = verifyPulledAclItemSignature(item);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('missing actorSigningPublicKey');
  });

  it('fails when sourceId cannot be parsed', () => {
    const item = makeSignedAclItem();
    item.sourceId = 'invalid';
    const result = verifyPulledAclItemSignature(item);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('cannot parse sourceId');
  });

  it('fails when signature does not match', () => {
    const item = makeSignedAclItem();
    item.itemId = 'tampered-item-id';
    const result = verifyPulledAclItemSignature(item);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('signature verification failed');
  });

  it('fails when public key is wrong', () => {
    const wrongKeys = generateKeyPair();
    const item = makeSignedAclItem();
    item.actorSigningPublicKey = bytesToBase64(wrongKeys.ed25519PublicKey);
    const result = verifyPulledAclItemSignature(item);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('signature verification failed');
  });

  it('fails when public key has invalid length', () => {
    const item = makeSignedAclItem();
    item.actorSigningPublicKey = bytesToBase64(new Uint8Array(16));
    const result = verifyPulledAclItemSignature(item);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('invalid public key length');
  });
});
