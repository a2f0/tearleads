import { vi } from 'vitest';

export const mockActivateScreensaver = vi.fn();

export const setupScreensaverMock = () => {
  vi.mock('@/components/screensaver', async () => {
    const actual = await vi.importActual<
      typeof import('@/components/screensaver')
    >('@/components/screensaver');
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
