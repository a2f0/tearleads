import { describe, expect, it } from 'vitest';
import {
  createConnectJsonPostInit,
  isPlainRecord,
  normalizeVfsCrdtSyncConnectPayload,
  normalizeVfsSyncConnectPayload,
  parseConnectJsonEnvelopeBody,
  parseConnectJsonString
} from './connectJson.js';

function encodeUuid(uuid: string): string {
  return Buffer.from(uuid.replace(/-/gu, ''), 'hex').toString('base64');
}

function encodeText(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

describe('connectJson helpers', () => {
  it('builds JSON post request init', () => {
    expect(createConnectJsonPostInit({ alpha: 1 })).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"alpha":1}'
    });
  });

  it('parses connect json strings', () => {
    expect(parseConnectJsonString('{"ok":true}')).toEqual({ ok: true });
    expect(parseConnectJsonString('')).toEqual({});
    expect(parseConnectJsonString(undefined)).toEqual({});
  });

  it('parses connect json envelope payloads', () => {
    expect(parseConnectJsonEnvelopeBody({ json: '{"ok":true}' })).toEqual({
      ok: true
    });
    expect(parseConnectJsonEnvelopeBody({ json: '  ' })).toEqual({});
    expect(parseConnectJsonEnvelopeBody({ json: { ok: true } })).toEqual({
      ok: true
    });
    expect(parseConnectJsonEnvelopeBody({ json: undefined })).toEqual({});
    expect(parseConnectJsonEnvelopeBody({ ok: true })).toEqual({ ok: true });
  });

  it('throws for invalid connect json envelopes', () => {
    expect(() => parseConnectJsonEnvelopeBody({ json: '{invalid' })).toThrow(
      'transport returned invalid connect json envelope'
    );
  });

  it('detects plain records only', () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord('x')).toBe(false);
  });

  it('normalizes VFS sync connect payloads', () => {
    const changedAtMs = 1_710_374_400_000;
    const createdAtMs = changedAtMs - 60_000;

    expect(
      normalizeVfsSyncConnectPayload({
        items: [
          {
            changeId: encodeUuid('00000000-0000-0000-0000-000000000101'),
            itemId: encodeUuid('00000000-0000-0000-0000-000000000102'),
            changeType: 'upsert',
            changedAtMs: String(changedAtMs),
            objectType: 'folder',
            encryptedName: 'encrypted-folder-name',
            ownerId: encodeUuid('00000000-0000-0000-0000-000000000103'),
            createdAtMs: String(createdAtMs),
            accessLevel: 'VFS_ACL_ACCESS_LEVEL_WRITE'
          }
        ],
        nextCursor: 'cursor-1',
        hasMore: true
      })
    ).toEqual({
      items: [
        {
          changeId: '00000000-0000-0000-0000-000000000101',
          itemId: '00000000-0000-0000-0000-000000000102',
          changeType: 'upsert',
          changedAt: new Date(changedAtMs).toISOString(),
          objectType: 'folder',
          encryptedName: 'encrypted-folder-name',
          ownerId: '00000000-0000-0000-0000-000000000103',
          createdAt: new Date(createdAtMs).toISOString(),
          accessLevel: 'write'
        }
      ],
      nextCursor: 'cursor-1',
      hasMore: true
    });
  });

  it('normalizes VFS CRDT connect payloads', () => {
    const occurredAtMs = 1_710_374_400_000;

    expect(
      normalizeVfsCrdtSyncConnectPayload({
        items: [
          {
            opId: encodeUuid('00000000-0000-0000-0000-000000000201'),
            itemId: encodeUuid('00000000-0000-0000-0000-000000000202'),
            opType: 'VFS_CRDT_OP_TYPE_ITEM_UPSERT',
            principalType: 'VFS_ACL_PRINCIPAL_TYPE_USER',
            principalId: encodeUuid('00000000-0000-0000-0000-000000000203'),
            accessLevel: 'VFS_ACL_ACCESS_LEVEL_WRITE',
            parentId: encodeUuid('00000000-0000-0000-0000-000000000204'),
            childId: encodeUuid('00000000-0000-0000-0000-000000000205'),
            actorId: encodeUuid('00000000-0000-0000-0000-000000000206'),
            sourceTable: 'vfs_item_state',
            sourceId: encodeText('source-1'),
            occurredAtMs: String(occurredAtMs),
            encryptedPayload: 'payload',
            keyEpoch: 3,
            encryptionNonce: 'nonce',
            encryptionAad: 'aad',
            encryptionSignature: 'sig',
            operationSignature: 'op-sig',
            actorSigningPublicKey: 'pub-key'
          }
        ],
        nextCursor: 'cursor-2',
        hasMore: false,
        lastReconciledWriteIds: {
          desktop: 4,
          mobile: 0,
          '  ': 2
        }
      })
    ).toEqual({
      items: [
        {
          opId: '00000000-0000-0000-0000-000000000201',
          itemId: '00000000-0000-0000-0000-000000000202',
          opType: 'item_upsert',
          principalType: 'user',
          principalId: '00000000-0000-0000-0000-000000000203',
          accessLevel: 'write',
          parentId: '00000000-0000-0000-0000-000000000204',
          childId: '00000000-0000-0000-0000-000000000205',
          actorId: '00000000-0000-0000-0000-000000000206',
          sourceTable: 'vfs_item_state',
          sourceId: 'source-1',
          occurredAt: new Date(occurredAtMs).toISOString(),
          encryptedPayload: 'payload',
          keyEpoch: 3,
          encryptionNonce: 'nonce',
          encryptionAad: 'aad',
          encryptionSignature: 'sig',
          operationSignature: 'op-sig',
          actorSigningPublicKey: 'pub-key'
        }
      ],
      nextCursor: 'cursor-2',
      hasMore: false,
      lastReconciledWriteIds: {
        desktop: 4
      }
    });
  });
});
