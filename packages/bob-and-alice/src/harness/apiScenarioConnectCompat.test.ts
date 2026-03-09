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
    expect(mapping?.body).toEqual({ json: JSON.stringify(payload) });
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
});
