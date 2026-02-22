import { vi } from 'vitest';

type MatchMediaOptions = {
  isMobile: boolean;
  isTouch?: boolean;
};

export function mockMatchMedia({
  isMobile,
  isTouch = false
}: MatchMediaOptions): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 1023px)' ? isMobile : isTouch,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}
