import { describe, expect, it, vi } from 'vitest';
import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey,
  splitEncapsulation,
  unwrapKeyWithKeyPair
} from '../crypto/asymmetric.js';
import { decrypt, importKey } from '../crypto/webCrypto.js';
import { encryptScaffoldVfsName } from './encryptScaffoldVfsName.js';

describe('encryptScaffoldVfsName', () => {
  it('encrypts name and wraps the session key for the owner', async () => {
    const ownerKeyPair = generateKeyPair();
    const ownerPublicKey = combinePublicKey(
      serializePublicKey({
        x25519PublicKey: ownerKeyPair.x25519PublicKey,
        mlKemPublicKey: ownerKeyPair.mlKemPublicKey
      })
    );

    const client = {
      query: async () => ({
        rows: [{ public_encryption_key: ownerPublicKey }]
      })
    };

    const result = await encryptScaffoldVfsName({
      client,
      ownerUserId: 'owner-1',
      plaintextName: 'Notes shared with Alice',
      allowOwnerWrappedSessionKey: true
    });

    expect(result.encryptedName).not.toBe('Notes shared with Alice');
    expect(result.encryptedSessionKey.split('.')).toHaveLength(4);

    const sessionKey = unwrapKeyWithKeyPair(
      splitEncapsulation(result.encryptedSessionKey),
      ownerKeyPair
    );
    const cryptoKey = await importKey(sessionKey);
    const decryptedNameBytes = await decrypt(
      Uint8Array.from(Buffer.from(result.encryptedName, 'base64')),
      cryptoKey
    );

    expect(new TextDecoder().decode(decryptedNameBytes)).toBe(
      'Notes shared with Alice'
    );
  });

  it('falls back when owner has no public key row', async () => {
    const client = {
      query: async () => ({ rows: [] })
    };

    const result = await encryptScaffoldVfsName({
      client,
      ownerUserId: 'owner-missing-key',
      plaintextName: 'Inbox',
      allowOwnerWrappedSessionKey: true
    });

    expect(result.encryptedSessionKey.startsWith('scaffold-unwrapped:')).toBe(
      true
    );

    const fallbackSessionKeyBase64 = result.encryptedSessionKey.replace(
      'scaffold-unwrapped:',
      ''
    );
    const cryptoKey = await importKey(
      Uint8Array.from(Buffer.from(fallbackSessionKeyBase64, 'base64'))
    );
    const decryptedNameBytes = await decrypt(
      Uint8Array.from(Buffer.from(result.encryptedName, 'base64')),
      cryptoKey
    );

    expect(new TextDecoder().decode(decryptedNameBytes)).toBe('Inbox');
  });

  it('defaults to scaffold-unwrapped session keys even when owner key exists', async () => {
    const ownerKeyPair = generateKeyPair();
    const ownerPublicKey = combinePublicKey(
      serializePublicKey({
        x25519PublicKey: ownerKeyPair.x25519PublicKey,
        mlKemPublicKey: ownerKeyPair.mlKemPublicKey
      })
    );

    const client = {
      query: vi.fn(async () => ({
        rows: [{ public_encryption_key: ownerPublicKey }]
      }))
    };

    const result = await encryptScaffoldVfsName({
      client,
      ownerUserId: 'owner-1',
      plaintextName: 'Notes shared with Alice'
    });

    expect(result.encryptedSessionKey.startsWith('scaffold-unwrapped:')).toBe(
      true
    );
    expect(client.query).not.toHaveBeenCalled();
  });
});
