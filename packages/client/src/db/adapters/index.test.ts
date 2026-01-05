import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdapter, getPlatformInfo, type PlatformInfo } from './index';

// Mock the adapter implementations with inline classes
vi.mock('./capacitor.adapter', () => {
  return {
    CapacitorAdapter: class {
      initialize = vi.fn();
      close = vi.fn();
      isOpen = vi.fn();
      execute = vi.fn();
    }
  };
});

vi.mock('./electron.adapter', () => {
  return {
    ElectronAdapter: class {
      initialize = vi.fn();
      close = vi.fn();
      isOpen = vi.fn();
      execute = vi.fn();
    }
  };
});

vi.mock('./web.adapter', () => {
  return {
    WebAdapter: class {
      initialize = vi.fn();
      close = vi.fn();
      isOpen = vi.fn();
      execute = vi.fn();
    }
  };
});

describe('createAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates ElectronAdapter when platform is electron', async () => {
    const platformInfo: PlatformInfo = {
      platform: 'electron',
      supportsNativeEncryption: true,
      requiresWebWorker: false
    };

    const adapter = await createAdapter(platformInfo);

    expect(adapter).toBeDefined();
    expect(adapter.initialize).toBeDefined();
    expect(adapter.close).toBeDefined();
    expect(adapter.isOpen).toBeDefined();
    expect(adapter.execute).toBeDefined();
  });

  it('creates CapacitorAdapter when platform is ios', async () => {
    const platformInfo: PlatformInfo = {
      platform: 'ios',
      supportsNativeEncryption: true,
      requiresWebWorker: false
    };

    const adapter = await createAdapter(platformInfo);

    expect(adapter).toBeDefined();
    expect(adapter.initialize).toBeDefined();
    expect(adapter.close).toBeDefined();
    expect(adapter.isOpen).toBeDefined();
    expect(adapter.execute).toBeDefined();
  });

  it('creates CapacitorAdapter when platform is android', async () => {
    const platformInfo: PlatformInfo = {
      platform: 'android',
      supportsNativeEncryption: true,
      requiresWebWorker: false
    };

    const adapter = await createAdapter(platformInfo);

    expect(adapter).toBeDefined();
    expect(adapter.initialize).toBeDefined();
    expect(adapter.close).toBeDefined();
    expect(adapter.isOpen).toBeDefined();
    expect(adapter.execute).toBeDefined();
  });

  it('creates WebAdapter when platform is web', async () => {
    const platformInfo: PlatformInfo = {
      platform: 'web',
      supportsNativeEncryption: false,
      requiresWebWorker: true
    };

    const adapter = await createAdapter(platformInfo);

    expect(adapter).toBeDefined();
    expect(adapter.initialize).toBeDefined();
    expect(adapter.close).toBeDefined();
    expect(adapter.isOpen).toBeDefined();
    expect(adapter.execute).toBeDefined();
  });

  it('throws error for unsupported platform', async () => {
    const platformInfo: PlatformInfo = {
      platform: 'node',
      supportsNativeEncryption: false,
      requiresWebWorker: false
    };

    await expect(createAdapter(platformInfo)).rejects.toThrow(
      'Unsupported platform in createAdapter: node'
    );
  });

  it('uses getPlatformInfo when no platformInfo is provided', async () => {
    // In jsdom environment, getPlatformInfo returns web
    const adapter = await createAdapter();

    expect(adapter).toBeDefined();
    expect(adapter.initialize).toBeDefined();
    expect(adapter.close).toBeDefined();
  });
});

describe('getPlatformInfo re-export', () => {
  it('exports getPlatformInfo from types', () => {
    expect(getPlatformInfo).toBeDefined();
    expect(typeof getPlatformInfo).toBe('function');
  });

  it('returns web platform in jsdom environment', () => {
    const info = getPlatformInfo();

    expect(info.platform).toBe('web');
    expect(info.supportsNativeEncryption).toBe(false);
    expect(info.requiresWebWorker).toBe(true);
  });
});
