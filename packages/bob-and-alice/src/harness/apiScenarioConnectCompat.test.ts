import { describe, expect, it } from 'vitest';
import { mapLegacyPathToConnect } from './apiScenarioConnectCompat.js';

describe('mapLegacyPathToConnect', () => {
  it('unwraps one level of double-encoded JSON for /vfs/register', () => {
    const payload = {
      id: 'note-1',
      objectType: 'note',
      encryptedSessionKey: 'wrapped-key'
    };
    const mapping = mapLegacyPathToConnect('/vfs/register', {
      method: 'POST',
      body: JSON.stringify(JSON.stringify(payload))
    });

    expect(mapping).not.toBeNull();
    expect(mapping?.path).toBe('/v1/connect/tearleads.v2.VfsService/Register');
    expect(mapping?.body).toEqual({
      id: 'note-1',
      objectType: 'note',
      encryptedSessionKey: 'wrapped-key',
      json: JSON.stringify(payload)
    });
  });

  it('unwraps one level of double-encoded JSON for auth routes', () => {
    const payload = {
      email: 'alice@example.test',
      password: 'secret-1'
    };
    const mapping = mapLegacyPathToConnect('/auth/register', {
      method: 'POST',
      body: JSON.stringify(JSON.stringify(payload))
    });

    expect(mapping).not.toBeNull();
    expect(mapping?.path).toBe('/v1/connect/tearleads.v1.AuthService/Register');
    expect(mapping?.body).toEqual(payload);
  });

  it('maps /vfs/items/:id/rekey with direct fields and json fallback', () => {
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
      itemId: 'item-1',
      json: JSON.stringify(payload)
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
});
