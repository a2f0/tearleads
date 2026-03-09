import { beforeEach, describe, expect, it, vi } from 'vitest';

const { registerDirectMock, rekeyItemDirectMock } = vi.hoisted(() => ({
  registerDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<unknown>>(),
  rekeyItemDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<unknown>>()
}));

vi.mock('./vfsDirectRegistry.js', () => ({
  registerDirect: (request: unknown, context: unknown) =>
    registerDirectMock(request, context),
  rekeyItemDirect: (request: unknown, context: unknown) =>
    rekeyItemDirectMock(request, context)
}));

import { vfsConnectService } from './vfsService.js';

describe('vfsConnectService register payload parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerDirectMock.mockResolvedValue({
      id: 'item-1',
      createdAt: '2026-03-03T00:00:00.000Z'
    });
    rekeyItemDirectMock.mockResolvedValue({
      itemId: 'item-1',
      newEpoch: 2,
      wrapsApplied: 0
    });
  });

  it('unwraps nested json payloads before delegating register', async () => {
    const context = {
      requestHeader: new Headers({
        authorization: 'Bearer token-1',
        'x-organization-id': 'org-1'
      })
    };
    const wrappedPayload = {
      json: JSON.stringify({
        json: JSON.stringify({
          id: 'wrapped-item',
          objectType: 'file',
          encryptedSessionKey: 'wrapped-session-key'
        })
      })
    };

    const response = await vfsConnectService.register(wrappedPayload, context);
    expect(response).toEqual({
      id: 'item-1',
      createdAt: '2026-03-03T00:00:00.000Z'
    });
    expect(registerDirectMock).toHaveBeenCalledWith(
      {
        id: 'wrapped-item',
        objectType: 'file',
        encryptedSessionKey: 'wrapped-session-key'
      },
      context
    );
  });

  it('accepts snake_case register payload aliases', async () => {
    const context = {
      requestHeader: new Headers({
        authorization: 'Bearer token-1',
        'x-organization-id': 'org-1'
      })
    };
    const aliasedPayload = {
      json: JSON.stringify({
        id: 'aliased-item',
        object_type: 'folder',
        encrypted_session_key: 'aliased-session-key'
      })
    };

    await vfsConnectService.register(aliasedPayload, context);
    expect(registerDirectMock).toHaveBeenCalledWith(
      {
        id: 'aliased-item',
        objectType: 'folder',
        encryptedSessionKey: 'aliased-session-key'
      },
      context
    );
  });
});
