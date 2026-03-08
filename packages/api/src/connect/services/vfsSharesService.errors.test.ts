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

describe('vfsSharesConnectService parse errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createShareDirectMock.mockReset();
    createOrgShareDirectMock.mockReset();
    updateShareDirectMock.mockReset();
  });

  it('rejects malformed mutation JSON at the service boundary', async () => {
    const context = { requestHeader: new Headers() };

    await expect(
      vfsSharesConnectService.createShare(
        { itemId: 'item-1', json: '{' },
        context
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    await expect(
      vfsSharesConnectService.updateShare(
        { shareId: 'share-1', json: '{' },
        context
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    await expect(
      vfsSharesConnectService.createOrgShare(
        { itemId: 'item-1', json: '{' },
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
