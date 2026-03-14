import { vi } from 'vitest';

export const mockActivateScreensaver = vi.fn();

export const setupScreensaverMock = () => {
  vi.mock('@/components/screensaver', async (importOriginal) => {
    const actual =
      await importOriginal<typeof import('@/components/screensaver')>();
    return {
      ...actual,
      useScreensaver: () => ({
        isActive: false,
        activate: mockActivateScreensaver,
        deactivate: vi.fn()
      })
    };
  });
};
