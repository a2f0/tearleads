import { Code } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createOrgShareDirectMock,
  createShareDirectMock,
  updateShareDirectMock
} = vi.hoisted(() => ({
  createOrgShareDirectMock: vi.fn(),
  createShareDirectMock: vi.fn(),
  updateShareDirectMock: vi.fn()
}));

vi.mock('./vfsSharesDirectMutations.js', () => ({
  createShareDirect: (...args: unknown[]) => createShareDirectMock(...args),
  updateShareDirect: (...args: unknown[]) => updateShareDirectMock(...args)
}));

vi.mock('./vfsSharesDirectOrgMutations.js', () => ({
  createOrgShareDirect: (...args: unknown[]) =>
    createOrgShareDirectMock(...args)
}));

import { vfsSharesConnectService } from './vfsSharesService.js';

function getMutationMethod(
  name: 'createShare' | 'updateShare' | 'createOrgShare'
): (...args: readonly unknown[]) => unknown {
  const method = Reflect.get(vfsSharesConnectService, name);
  if (typeof method !== 'function') {
    throw new Error(`Expected ${name} to be callable`);
  }
  return (...args) => Reflect.apply(method, vfsSharesConnectService, args);
}

describe('vfsSharesConnectService parse errors', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects invalid mutation payloads at the service boundary', async () => {
    const context = { requestHeader: new Headers() };

    await expect(
      vfsSharesConnectService.createShare(
        {
          itemId: 'item-1',
          shareType: 'invalid',
          targetId: 'user-2',
          permissionLevel: 'view'
        },
        context
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    await expect(
      vfsSharesConnectService.updateShare(
        {
          shareId: 'share-1',
          permissionLevel: 'owner',
          clearExpiresAt: false
        },
        context
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    await expect(
      vfsSharesConnectService.updateShare(
        {
          shareId: 'share-1',
          expiresAt: '2026-03-01T00:00:00Z',
          clearExpiresAt: true
        },
        context
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    await expect(
      vfsSharesConnectService.createOrgShare(
        {
          itemId: 'item-1',
          sourceOrgId: '',
          targetOrgId: 'org-2',
          permissionLevel: 'view'
        },
        context
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    expect(createShareDirectMock).not.toHaveBeenCalled();
    expect(updateShareDirectMock).not.toHaveBeenCalled();
    expect(createOrgShareDirectMock).not.toHaveBeenCalled();
  });

  it('rejects legacy json-wrapped mutation payloads', async () => {
    const context = { requestHeader: new Headers() };
    const createShare = getMutationMethod('createShare');
    const updateShare = getMutationMethod('updateShare');
    const createOrgShare = getMutationMethod('createOrgShare');

    await expect(
      createShare(
        {
          itemId: 'item-1',
          json: JSON.stringify({
            shareType: 'user',
            targetId: 'user-2',
            permissionLevel: 'view'
          })
        },
        context
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    await expect(
      updateShare(
        {
          shareId: 'share-1',
          json: JSON.stringify({
            permissionLevel: 'view'
          })
        },
        context
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    await expect(
      createOrgShare(
        {
          itemId: 'item-1',
          json: JSON.stringify({
            sourceOrgId: 'org-1',
            targetOrgId: 'org-2',
            permissionLevel: 'view'
          })
        },
        context
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    expect(createShareDirectMock).not.toHaveBeenCalled();
    expect(updateShareDirectMock).not.toHaveBeenCalled();
    expect(createOrgShareDirectMock).not.toHaveBeenCalled();
  });
});
