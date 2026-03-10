import { describe, expect, it } from 'vitest';
import { mapLegacyPathToConnect } from './apiScenarioConnectCompat.js';

describe('mapLegacyPathToConnect', () => {
  it('does not remap direct v2 connect routes', () => {
    const payload = {
      id: 'note-1',
      objectType: 'note',
      encryptedSessionKey: 'wrapped-key'
    };
    const mapping = mapLegacyPathToConnect(
      '/connect/tearleads.v2.VfsService/Register',
      {
        method: 'POST',
        body: JSON.stringify(JSON.stringify(payload))
      }
    );

    expect(mapping).toBeNull();
  });

  it('does not map legacy auth routes', () => {
    const payload = {
      email: 'alice@example.test',
      password: 'secret-1'
    };
    const mapping = mapLegacyPathToConnect('/auth/register', {
      method: 'POST',
      body: JSON.stringify(JSON.stringify(payload))
    });

    expect(mapping).toBeNull();
  });

  it('maps /vfs/items/:id/rekey with direct fields', () => {
    const payload = {
      reason: 'manual',
      newEpoch: 2,
      wrappedKeys: [
        {
          recipientUserId: 'user-1',
          recipientPublicKeyId: 'pk-1',
          keyEpoch: 2,
          encryptedKey: 'cipher',
          senderSignature: 'sig'
        }
      ]
    };
    const mapping = mapLegacyPathToConnect('/vfs/items/item-1/rekey', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    expect(mapping).not.toBeNull();
    expect(mapping?.path).toBe('/v1/connect/tearleads.v2.VfsService/RekeyItem');
    expect(mapping?.body).toEqual({
      ...payload,
      itemId: 'item-1'
    });
  });

  it('sets empty share defaults for /vfs/items/:id/shares GET', () => {
    const mapping = mapLegacyPathToConnect('/vfs/items/item-1/shares', {
      method: 'GET'
    });

    expect(mapping).not.toBeNull();
    expect(mapping?.path).toBe(
      '/v1/connect/tearleads.v2.VfsSharesService/GetItemShares'
    );
    expect(mapping?.legacyDefaults).toEqual({ shares: [], orgShares: [] });
  });

  it('does not map legacy AI usage routes', () => {
    const mapping = mapLegacyPathToConnect('/ai/usage', {
      method: 'POST',
      body: JSON.stringify({
        modelId: 'openai/gpt-4o-mini',
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20
      })
    });

    expect(mapping).toBeNull();
  });

  it('does not map legacy vfs key routes', () => {
    const mapping = mapLegacyPathToConnect('/vfs/keys', {
      method: 'POST',
      body: JSON.stringify({
        publicEncryptionKey: 'enc-key',
        publicSigningKey: 'sign-key',
        encryptedPrivateKeys: 'encrypted-private-keys',
        argon2Salt: 'salt'
      })
    });

    expect(mapping).toBeNull();
  });

  it('does not map legacy vfs sync routes', () => {
    const mapping = mapLegacyPathToConnect('/vfs/vfs-sync?limit=500', {
      method: 'GET'
    });

    expect(mapping).toBeNull();
  });
});
