import { vi } from 'vitest';

export const mockActivateScreensaver = vi.fn();

export const setupScreensaverMock = () => {
  vi.mock('@/components/screensaver', () => {
    return {
      useScreensaver: () => ({
        isActive: false,
        activate: mockActivateScreensaver,
        deactivate: vi.fn()
      })
    };
  });
};
