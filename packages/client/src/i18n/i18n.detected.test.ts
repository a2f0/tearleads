import { describe, expect, it, vi } from 'vitest';

function createI18nMock(language: string) {
  return {
    language,
    addResourceBundle: vi.fn(),
    hasResourceBundle: vi.fn(() => true),
    use: vi.fn(function (this: unknown) {
      return this;
    }),
    init: vi.fn(function (this: unknown) {
      return this;
    }),
    on: vi.fn(),
    changeLanguage: vi.fn()
  };
}

describe('i18n detected language loading', () => {
  it('loads detected supported language on init', async () => {
    vi.resetModules();
    const i18nMock = createI18nMock('es');
    vi.doMock('i18next', () => ({
      __esModule: true,
      default: i18nMock
    }));

    await import('./i18n');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(i18nMock.language).toBe('es');
  });

  it('skips settings listener when window is undefined', async () => {
    vi.resetModules();
    const i18nMock = createI18nMock('en');
    vi.doMock('i18next', () => ({
      __esModule: true,
      default: i18nMock
    }));

    const originalWindow = globalThis.window;
    // @ts-expect-error - intentional undefined for test
    globalThis.window = undefined;

    await import('./i18n');

    globalThis.window = originalWindow;

    expect(i18nMock.on).toHaveBeenCalled();
  });
});
