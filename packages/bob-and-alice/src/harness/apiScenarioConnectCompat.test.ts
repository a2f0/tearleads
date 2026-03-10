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

  it('does not map legacy rekey routes', () => {
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

    expect(mapping).toBeNull();
  });

  it('does not map legacy share routes', () => {
    const mapping = mapLegacyPathToConnect('/vfs/items/item-1/shares', {
      method: 'POST',
      body: JSON.stringify({
        shareType: 'user',
        targetId: 'user-2',
        permissionLevel: 'view'
      })
    });

    expect(mapping).toBeNull();
  });

  it('does not map legacy share mutation routes', () => {
    expect(
      mapLegacyPathToConnect('/vfs/shares/share-1', {
        method: 'PATCH',
        body: JSON.stringify({ permissionLevel: 'edit' })
      })
    ).toBeNull();
    expect(
      mapLegacyPathToConnect('/vfs/shares/share-1', {
        method: 'DELETE'
      })
    ).toBeNull();
  });

  it('does not map legacy org-share routes', () => {
    expect(
      mapLegacyPathToConnect('/vfs/items/item-1/org-shares', {
        method: 'POST',
        body: JSON.stringify({
          sourceOrgId: 'org-1',
          targetOrgId: 'org-2',
          permissionLevel: 'view'
        })
      })
    ).toBeNull();
    expect(
      mapLegacyPathToConnect('/vfs/org-shares/share-1', {
        method: 'DELETE'
      })
    ).toBeNull();
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
