import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn()
}));

vi.mock('../apiCore', () => ({
  request: requestMock
}));

import { authRoutes } from './authRoutes';

describe('authRoutes', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({});
  });

  it('includes vfs key setup when present on register requests', async () => {
    const vfsKeySetup = {
      publicEncryptionKey: 'pub-key',
      publicSigningKey: 'signing-key',
      encryptedPrivateKeys: 'encrypted-private-keys',
      argon2Salt: 'argon2-salt'
    };

    await authRoutes.register('dev@tearleads.test', 'password-1', vfsKeySetup);

    const [path, params] = requestMock.mock.calls[0] ?? [];
    expect(path).toBe('/connect/tearleads.v1.AuthService/Register');

    const body = params?.fetchOptions?.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') {
      return;
    }

    expect(JSON.parse(body)).toEqual({
      email: 'dev@tearleads.test',
      password: 'password-1',
      vfsKeySetup
    });
  });
});
