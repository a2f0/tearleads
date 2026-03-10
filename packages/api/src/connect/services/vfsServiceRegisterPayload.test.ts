import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<unknown>>();
const rekeyItemDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<unknown>>();

vi.mock('./vfsDirectRegistry.js', () => ({
  registerDirect: (request: unknown, context: unknown) =>
    registerDirectMock(request, context),
  rekeyItemDirect: (request: unknown, context: unknown) =>
    rekeyItemDirectMock(request, context)
}));

import { vfsConnectService } from './vfsService.js';

function createContext() {
  return {
    requestHeader: new Headers({
      authorization: 'Bearer token-1',
      'x-organization-id': 'org-1'
    })
  };
}

function callRegister(
  request: unknown,
  context: ReturnType<typeof createContext>
) {
  return Reflect.apply(vfsConnectService.register, vfsConnectService, [
    request,
    context
  ]);
}

function callRekeyItem(
  request: unknown,
  context: ReturnType<typeof createContext>
) {
  return Reflect.apply(vfsConnectService.rekeyItem, vfsConnectService, [
    request,
    context
  ]);
}

describe('vfsConnectService mutation payload parsing', () => {
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

  it('rejects legacy json-wrapped register payloads', async () => {
    const context = createContext();
    const wrappedPayload = {
      json: JSON.stringify({
        json: JSON.stringify({
          id: 'wrapped-item',
          objectType: 'file',
          encryptedSessionKey: 'wrapped-session-key'
        })
      })
    };

    await expect(callRegister(wrappedPayload, context)).rejects.toThrow(
      'id, objectType, and encryptedSessionKey are required'
    );
    expect(registerDirectMock).not.toHaveBeenCalled();
  });

  it('rejects legacy json-wrapped rekey payloads', async () => {
    const context = createContext();
    const wrappedPayload = {
      itemId: 'item-1',
      json: JSON.stringify({
        reason: 'manual',
        newEpoch: 2,
        wrappedKeys: []
      })
    };

    await expect(callRekeyItem(wrappedPayload, context)).rejects.toThrow(
      'Invalid request payload. Please check the `reason`, `newEpoch`, and `wrappedKeys` fields.'
    );
    expect(rekeyItemDirectMock).not.toHaveBeenCalled();
  });
});
