import { describe, expect, it } from 'vitest';
import {
  parseCreateOrgSharePayload,
  parseCreateSharePayload,
  parseUpdateSharePayload
} from './shared.js';

describe('vfs-shares shared payload parsing', () => {
  it('parses create share payloads with normalized values', () => {
    expect(
      parseCreateSharePayload({
        itemId: ' item-1 ',
        shareType: 'user',
        targetId: ' user-1 ',
        permissionLevel: 'view',
        expiresAt: ' 2026-03-03T00:00:00.000Z '
      })
    ).toEqual({
      itemId: 'item-1',
      shareType: 'user',
      targetId: 'user-1',
      permissionLevel: 'view',
      expiresAt: '2026-03-03T00:00:00.000Z',
      wrappedKey: null
    });
  });

  it('rejects invalid create share payloads', () => {
    expect(parseCreateSharePayload(null)).toBeNull();
    expect(
      parseCreateSharePayload({
        itemId: 'item-1',
        shareType: 'invalid',
        targetId: 'user-1',
        permissionLevel: 'view'
      })
    ).toBeNull();
    expect(
      parseCreateSharePayload({
        itemId: 'item-1',
        shareType: 'user',
        targetId: 'user-1',
        permissionLevel: 'view',
        wrappedKey: { invalid: true }
      })
    ).toBeNull();
    expect(
      parseCreateSharePayload({
        itemId: 'item-1',
        shareType: 'user',
        targetId: 'user-1',
        permissionLevel: 'view',
        wrappedKey: {
          recipientUserId: 'user-2',
          recipientPublicKeyId: 'key-1',
          keyEpoch: 1,
          encryptedKey: 'encrypted',
          senderSignature: 'signature'
        }
      })
    ).toBeNull();
  });

  it('parses create org-share payloads and validates source ids', () => {
    expect(
      parseCreateOrgSharePayload({
        itemId: ' item-1 ',
        sourceOrgId: ' source-org ',
        targetOrgId: ' target-org ',
        permissionLevel: 'edit',
        wrappedKey: {
          recipientOrgId: 'target-org',
          recipientPublicKeyId: 'key-1',
          keyEpoch: 1,
          encryptedKey: 'encrypted',
          senderSignature: 'signature'
        }
      })
    ).toEqual({
      itemId: 'item-1',
      sourceOrgId: 'source-org',
      targetOrgId: 'target-org',
      permissionLevel: 'edit',
      expiresAt: null,
      wrappedKey: {
        recipientOrgId: 'target-org',
        recipientPublicKeyId: 'key-1',
        keyEpoch: 1,
        encryptedKey: 'encrypted',
        senderSignature: 'signature'
      }
    });

    expect(
      parseCreateOrgSharePayload({
        itemId: 'item-1',
        sourceOrgId: 'source:org',
        targetOrgId: 'target-org',
        permissionLevel: 'view'
      })
    ).toBeNull();

    expect(
      parseCreateOrgSharePayload({
        itemId: 'item-1',
        sourceOrgId: 'source-org',
        targetOrgId: 'target-org',
        permissionLevel: 'view',
        wrappedKey: {
          recipientOrgId: 'other-org',
          recipientPublicKeyId: 'key-1',
          keyEpoch: 1,
          encryptedKey: 'encrypted',
          senderSignature: 'signature'
        }
      })
    ).toBeNull();
  });

  it('parses update payloads and rejects invalid updates', () => {
    expect(parseUpdateSharePayload({})).toEqual({});
    expect(
      parseUpdateSharePayload({
        permissionLevel: 'download',
        expiresAt: null
      })
    ).toEqual({
      permissionLevel: 'download',
      expiresAt: null
    });

    expect(parseUpdateSharePayload(null)).toBeNull();
    expect(parseUpdateSharePayload({ permissionLevel: 'invalid' })).toBeNull();
    expect(parseUpdateSharePayload({ expiresAt: 123 })).toBeNull();
  });
});
