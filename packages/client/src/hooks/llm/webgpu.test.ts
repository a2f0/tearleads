import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkWebGPUSupport, loadLocalModel } from './webgpu';

const {
  mockEmitChange,
  mockSendRequest,
  mockSetLoadCallbacks,
  mockSetLoadingModelId,
  mockStore,
  mockGetWebGPUErrorInfo
} = vi.hoisted(() => ({
  mockEmitChange: vi.fn(),
  mockSendRequest: vi.fn(),
  mockSetLoadCallbacks: vi.fn(),
  mockSetLoadingModelId: vi.fn(),
  mockStore: {
    isLoading: false,
    error: null as string | null,
    loadProgress: null as { text: string; progress: number } | null
  },
  mockGetWebGPUErrorInfo: vi.fn(() => ({
    message: 'WebGPU unavailable.',
    requirement: 'Use a WebGPU-capable browser.'
  }))
}));

vi.mock('@/lib/utils', () => ({
  getWebGPUErrorInfo: () => mockGetWebGPUErrorInfo()
}));

vi.mock('./store', () => ({
  emitChange: () => mockEmitChange(),
  sendRequest: (...args: unknown[]) => mockSendRequest(...args),
  setLoadCallbacks: (...args: unknown[]) => mockSetLoadCallbacks(...args),
  setLoadingModelId: (...args: unknown[]) => mockSetLoadingModelId(...args),
  store: mockStore
}));

describe('checkWebGPUSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when navigator is undefined', async () => {
    vi.stubGlobal('navigator', undefined);

    const supported = await checkWebGPUSupport();

    expect(supported).toBe(false);
  });

  it('returns false when navigator has no gpu property', async () => {
    const requestAdapter = vi.fn();
    vi.stubGlobal('navigator', {} as Navigator);

    const supported = await checkWebGPUSupport();

    expect(supported).toBe(false);
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it('returns true when an adapter is available', async () => {
    const requestAdapter = vi.fn(async () => ({ name: 'adapter' }));
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter }
    } as unknown as Navigator);

    const supported = await checkWebGPUSupport();

    expect(supported).toBe(true);
  });

  it('returns false when requestAdapter resolves to null', async () => {
    const requestAdapter = vi.fn(async () => null);
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter }
    } as unknown as Navigator);

    const supported = await checkWebGPUSupport();

    expect(supported).toBe(false);
  });

  it('returns false when requestAdapter throws', async () => {
    const requestAdapter = vi.fn(async () => {
      throw new Error('gpu failure');
    });
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter }
    } as unknown as Navigator);

    const supported = await checkWebGPUSupport();

    expect(supported).toBe(false);
  });
});

describe('loadLocalModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.isLoading = false;
    mockStore.error = null;
    mockStore.loadProgress = null;
  });

  it('sets an error and exits when WebGPU is unsupported', async () => {
    vi.stubGlobal('navigator', {} as Navigator);

    await loadLocalModel('test-model');

    expect(mockStore.error).toContain('WebGPU unavailable.');
    expect(mockEmitChange).toHaveBeenCalled();
    expect(mockSendRequest).not.toHaveBeenCalled();
  });
});
