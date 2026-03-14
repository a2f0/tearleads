import { create } from '@bufbuild/protobuf';
import { VfsGetMyKeysRequestSchema } from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMyKeysDirectMock =
  vi.fn<
    (
      request: unknown,
      context: unknown
    ) => Promise<{
      publicEncryptionKey: string;
      publicSigningKey: string;
      encryptedPrivateKeys?: string;
      argon2Salt?: string;
    }>
  >();
const setupKeysDirectMock =
  vi.fn<
    (request: unknown, context: unknown) => Promise<{ created: boolean }>
  >();

vi.mock('./vfsDirectKeys.js', () => ({
  getMyKeysDirect: (request: unknown, context: unknown) =>
    getMyKeysDirectMock(request, context),
  setupKeysDirect: (request: unknown, context: unknown) =>
    setupKeysDirectMock(request, context)
}));

import { vfsConnectRouterService } from './vfsConnectRouterService.js';

describe('vfsConnectRouterService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyKeysDirectMock.mockResolvedValue({
      publicEncryptionKey: 'pub-enc',
      publicSigningKey: 'pub-sign',
      encryptedPrivateKeys: 'enc-priv',
      argon2Salt: 'salt-1'
    });
    setupKeysDirectMock.mockResolvedValue({ created: true });
  });

  it('keeps key routes available for connect router callers', async () => {
    const context = {
      requestHeader: new Headers({
        authorization: 'Bearer token-1',
        'x-organization-id': 'org-1'
      })
    };
    const setupKeysRequest = {
      publicEncryptionKey: 'public-encryption-key',
      publicSigningKey: 'public-signing-key',
      encryptedPrivateKeys: 'encrypted-private-keys',
      argon2Salt: 'argon2-salt'
    };

    const getMyKeysResponse = await vfsConnectRouterService.getMyKeys(
      create(VfsGetMyKeysRequestSchema, {}),
      context
    );
    expect(getMyKeysResponse).toEqual({
      publicKeyIds: ['pub-enc', 'pub-sign'],
      publicEncryptionKey: 'pub-enc',
      publicSigningKey: 'pub-sign',
      encryptedPrivateKeys: 'enc-priv',
      argon2Salt: 'salt-1'
    });
    expect(getMyKeysDirectMock).toHaveBeenCalledWith({}, context);

    const setupKeysResponse = await vfsConnectRouterService.setupKeys(
      setupKeysRequest,
      context
    );
    expect(setupKeysResponse).toEqual({
      success: true,
      created: true
    });
    expect(setupKeysDirectMock).toHaveBeenCalledWith(setupKeysRequest, context);
  });
});
