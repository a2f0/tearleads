import { describe, expect, it } from 'vitest';
import {
  parseOrgWrappedKeyPayload,
  parseWrappedKeyPayload
} from './wrappedKeyParsers.js';

describe('wrappedKeyParsers', () => {
  it('parses and normalizes wrapped key payloads', () => {
    expect(
      parseWrappedKeyPayload({
        recipientUserId: ' user-1 ',
        recipientPublicKeyId: ' key-1 ',
        keyEpoch: 2,
        encryptedKey: ' encrypted ',
        senderSignature: ' signature '
      })
    ).toEqual({
      recipientUserId: 'user-1',
      recipientPublicKeyId: 'key-1',
      keyEpoch: 2,
      encryptedKey: 'encrypted',
      senderSignature: 'signature'
    });
  });

  it('rejects invalid wrapped key payloads', () => {
    expect(parseWrappedKeyPayload(null)).toBeNull();
    expect(
      parseWrappedKeyPayload({
        recipientUserId: 'user-1',
        recipientPublicKeyId: 'key-1',
        keyEpoch: 0,
        encryptedKey: 'encrypted',
        senderSignature: 'signature'
      })
    ).toBeNull();
    expect(
      parseWrappedKeyPayload({
        recipientUserId: ' ',
        recipientPublicKeyId: 'key-1',
        keyEpoch: 1,
        encryptedKey: 'encrypted',
        senderSignature: 'signature'
      })
    ).toBeNull();
  });

  it('parses org wrapped key payloads and validates required fields', () => {
    expect(
      parseOrgWrappedKeyPayload({
        recipientOrgId: ' org-1 ',
        recipientPublicKeyId: ' key-1 ',
        keyEpoch: 1,
        encryptedKey: ' encrypted ',
        senderSignature: ' signature '
      })
    ).toEqual({
      recipientOrgId: 'org-1',
      recipientPublicKeyId: 'key-1',
      keyEpoch: 1,
      encryptedKey: 'encrypted',
      senderSignature: 'signature'
    });

    expect(
      parseOrgWrappedKeyPayload({
        recipientPublicKeyId: 'key-1',
        keyEpoch: 1,
        encryptedKey: 'encrypted',
        senderSignature: 'signature'
      })
    ).toBeNull();
  });
});
