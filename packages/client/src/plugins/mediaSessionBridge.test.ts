import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsNativePlatform = vi.fn();
const mockGetPlatform = vi.fn();
const mockRegisterPlugin = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform(),
    getPlatform: () => mockGetPlatform()
  },
  registerPlugin: (...args: unknown[]) => mockRegisterPlugin(...args)
}));

describe('mediaSessionBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterPlugin.mockReturnValue({});
    mockIsNativePlatform.mockReturnValue(false);
    mockGetPlatform.mockReturnValue('web');
  });

  it('registers the MediaSessionBridge plugin', async () => {
    await import('./mediaSessionBridge');

    expect(mockRegisterPlugin).toHaveBeenCalledWith('MediaSessionBridge');
  });

  it('detects android native platform', async () => {
    const module = await import('./mediaSessionBridge');
    mockIsNativePlatform.mockReturnValue(true);
    mockGetPlatform.mockReturnValue('android');

    expect(module.isAndroidNativePlatform()).toBe(true);
  });

  it('returns false for non-android platform', async () => {
    const module = await import('./mediaSessionBridge');
    mockIsNativePlatform.mockReturnValue(true);
    mockGetPlatform.mockReturnValue('ios');

    expect(module.isAndroidNativePlatform()).toBe(false);
  });
});
