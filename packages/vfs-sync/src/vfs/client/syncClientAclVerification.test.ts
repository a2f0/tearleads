import type { VfsCrdtSyncItem } from '@tearleads/shared';
import {
  bytesToBase64,
  generateKeyPair,
  signAclOperation
} from '@tearleads/shared';
import { describe, expect, it } from 'vitest';
import { VfsAclTofuKeyStore } from './syncClientAclKeyStore.js';
import type { VfsAclVerificationFailure } from './syncClientAclVerification.js';
import { verifyPullAclSignatures } from './syncClientAclVerification.js';

const CLIENT_PUSH_SOURCE_TABLE = 'vfs_crdt_client_push';

function buildSignedAclItem(params: {
  opId: string;
  opType: 'acl_add' | 'acl_remove';
  itemId: string;
  replicaId: string;
  writeId: number;
  occurredAt: string;
  principalType: 'user' | 'group' | 'organization';
  principalId: string;
  accessLevel: 'read' | 'write' | 'admin' | null;
  actorId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}): VfsCrdtSyncItem {
  const signature = signAclOperation(
    {
      opId: params.opId,
      opType: params.opType,
      itemId: params.itemId,
      replicaId: params.replicaId,
      writeId: params.writeId,
      occurredAt: params.occurredAt,
      principalType: params.principalType,
      principalId: params.principalId,
      accessLevel:
        params.opType === 'acl_remove' ? '' : (params.accessLevel ?? '')
    },
    params.privateKey
  );

  return {
    opId: params.opId,
    itemId: params.itemId,
    opType: params.opType,
    principalType: params.principalType,
    principalId: params.principalId,
    accessLevel: params.opType === 'acl_remove' ? null : params.accessLevel,
    parentId: null,
    childId: null,
    actorId: params.actorId,
    sourceTable: CLIENT_PUSH_SOURCE_TABLE,
    sourceId: `${params.actorId}:${params.replicaId}:${params.writeId}:${params.opId}`,
    occurredAt: params.occurredAt,
    operationSignature: signature,
    actorSigningPublicKey: bytesToBase64(params.publicKey)
  };
}

describe('verifyPullAclSignatures', () => {
  it('passes verification for validly signed acl_add operations', () => {
    const keyPair = generateKeyPair();
    const item = buildSignedAclItem({
      opId: 'op-1',
      opType: 'acl_add',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-03-15T10:00:00.000Z',
      principalType: 'user',
      principalId: 'user-2',
      accessLevel: 'read',
      actorId: 'user-1',
      privateKey: keyPair.ed25519PrivateKey,
      publicKey: keyPair.ed25519PublicKey
    });

    const failures: VfsAclVerificationFailure[] = [];
    const count = verifyPullAclSignatures({
      items: [item],
      tofuKeyStore: null,
      onVerificationFailure: (f) => failures.push(f)
    });

    expect(count).toBe(0);
    expect(failures).toHaveLength(0);
  });

  it('passes verification for validly signed acl_remove operations', () => {
    const keyPair = generateKeyPair();
    const item = buildSignedAclItem({
      opId: 'op-2',
      opType: 'acl_remove',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 2,
      occurredAt: '2026-03-15T10:01:00.000Z',
      principalType: 'user',
      principalId: 'user-2',
      accessLevel: null,
      actorId: 'user-1',
      privateKey: keyPair.ed25519PrivateKey,
      publicKey: keyPair.ed25519PublicKey
    });

    const failures: VfsAclVerificationFailure[] = [];
    const count = verifyPullAclSignatures({
      items: [item],
      tofuKeyStore: null,
      onVerificationFailure: (f) => failures.push(f)
    });

    expect(count).toBe(0);
    expect(failures).toHaveLength(0);
  });

  it('skips non-ACL operations', () => {
    const item: VfsCrdtSyncItem = {
      opId: 'op-link',
      itemId: 'item-1',
      opType: 'link_add',
      principalType: null,
      principalId: null,
      accessLevel: null,
      parentId: 'folder-1',
      childId: 'item-1',
      actorId: 'user-1',
      sourceTable: CLIENT_PUSH_SOURCE_TABLE,
      sourceId: 'user-1:desktop:1:op-link',
      occurredAt: '2026-03-15T10:00:00.000Z'
    };

    const count = verifyPullAclSignatures({
      items: [item],
      tofuKeyStore: null,
      onVerificationFailure: null
    });

    expect(count).toBe(0);
  });

  it('reports missing_signature when operationSignature is absent', () => {
    const keyPair = generateKeyPair();
    const item = buildSignedAclItem({
      opId: 'op-3',
      opType: 'acl_add',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-03-15T10:00:00.000Z',
      principalType: 'user',
      principalId: 'user-2',
      accessLevel: 'read',
      actorId: 'user-1',
      privateKey: keyPair.ed25519PrivateKey,
      publicKey: keyPair.ed25519PublicKey
    });
    delete (item as Record<string, unknown>).operationSignature;

    const failures: VfsAclVerificationFailure[] = [];
    const count = verifyPullAclSignatures({
      items: [item],
      tofuKeyStore: null,
      onVerificationFailure: (f) => failures.push(f)
    });

    expect(count).toBe(1);
    expect(failures[0]?.reason).toBe('missing_signature');
  });

  it('reports missing_public_key when actorSigningPublicKey is absent', () => {
    const keyPair = generateKeyPair();
    const item = buildSignedAclItem({
      opId: 'op-4',
      opType: 'acl_add',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-03-15T10:00:00.000Z',
      principalType: 'user',
      principalId: 'user-2',
      accessLevel: 'read',
      actorId: 'user-1',
      privateKey: keyPair.ed25519PrivateKey,
      publicKey: keyPair.ed25519PublicKey
    });
    delete (item as Record<string, unknown>).actorSigningPublicKey;

    const failures: VfsAclVerificationFailure[] = [];
    const count = verifyPullAclSignatures({
      items: [item],
      tofuKeyStore: null,
      onVerificationFailure: (f) => failures.push(f)
    });

    expect(count).toBe(1);
    expect(failures[0]?.reason).toBe('missing_public_key');
  });

  it('reports invalid_signature when signature does not match', () => {
    const keyPair = generateKeyPair();
    const otherKeyPair = generateKeyPair();
    const item = buildSignedAclItem({
      opId: 'op-5',
      opType: 'acl_add',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-03-15T10:00:00.000Z',
      principalType: 'user',
      principalId: 'user-2',
      accessLevel: 'read',
      actorId: 'user-1',
      privateKey: keyPair.ed25519PrivateKey,
      publicKey: otherKeyPair.ed25519PublicKey
    });

    const failures: VfsAclVerificationFailure[] = [];
    const count = verifyPullAclSignatures({
      items: [item],
      tofuKeyStore: null,
      onVerificationFailure: (f) => failures.push(f)
    });

    expect(count).toBe(1);
    expect(failures[0]?.reason).toBe('invalid_signature');
  });

  it('reports missing_signing_fields for non-client-push sources', () => {
    const keyPair = generateKeyPair();
    const item = buildSignedAclItem({
      opId: 'op-6',
      opType: 'acl_add',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-03-15T10:00:00.000Z',
      principalType: 'user',
      principalId: 'user-2',
      accessLevel: 'read',
      actorId: 'user-1',
      privateKey: keyPair.ed25519PrivateKey,
      publicKey: keyPair.ed25519PublicKey
    });
    item.sourceTable = 'vfs_acl_direct';

    const failures: VfsAclVerificationFailure[] = [];
    const count = verifyPullAclSignatures({
      items: [item],
      tofuKeyStore: null,
      onVerificationFailure: (f) => failures.push(f)
    });

    expect(count).toBe(1);
    expect(failures[0]?.reason).toBe('missing_signing_fields');
  });
});

describe('VfsAclTofuKeyStore', () => {
  it('pins key on first encounter and accepts same key on subsequent calls', () => {
    const store = new VfsAclTofuKeyStore();
    const keyPair = generateKeyPair();
    const pubKeyBase64 = bytesToBase64(keyPair.ed25519PublicKey);

    expect(store.verifyOrPin('user-1', pubKeyBase64)).toBe(true);
    expect(store.verifyOrPin('user-1', pubKeyBase64)).toBe(true);
  });

  it('rejects different key for the same actor', () => {
    const store = new VfsAclTofuKeyStore();
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();

    expect(
      store.verifyOrPin('user-1', bytesToBase64(keyPair1.ed25519PublicKey))
    ).toBe(true);
    expect(
      store.verifyOrPin('user-1', bytesToBase64(keyPair2.ed25519PublicKey))
    ).toBe(false);
  });

  it('accepts different keys for different actors', () => {
    const store = new VfsAclTofuKeyStore();
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();

    expect(
      store.verifyOrPin('user-1', bytesToBase64(keyPair1.ed25519PublicKey))
    ).toBe(true);
    expect(
      store.verifyOrPin('user-2', bytesToBase64(keyPair2.ed25519PublicKey))
    ).toBe(true);
  });

  it('reports tofu_key_conflict through verification pipeline', () => {
    const store = new VfsAclTofuKeyStore();
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();

    store.verifyOrPin('user-1', bytesToBase64(keyPair1.ed25519PublicKey));

    const item = buildSignedAclItem({
      opId: 'op-tofu',
      opType: 'acl_add',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-03-15T10:00:00.000Z',
      principalType: 'user',
      principalId: 'user-2',
      accessLevel: 'read',
      actorId: 'user-1',
      privateKey: keyPair2.ed25519PrivateKey,
      publicKey: keyPair2.ed25519PublicKey
    });

    const failures: VfsAclVerificationFailure[] = [];
    const count = verifyPullAclSignatures({
      items: [item],
      tofuKeyStore: store,
      onVerificationFailure: (f) => failures.push(f)
    });

    expect(count).toBe(1);
    expect(failures[0]?.reason).toBe('tofu_key_conflict');
  });
});
