import { describe, expect, it } from 'vitest';
import {
  getLangFromPath,
  getLocalizedPath,
  getStaticPathsForLocales
} from './utils';

describe('i18n utils', () => {
  describe('getLocalizedPath', () => {
    it('replaces language prefix in path', () => {
      expect(getLocalizedPath('/en/docs/api', 'es')).toBe('/es/docs/api');
      expect(getLocalizedPath('/en/docs/api', 'ua')).toBe('/ua/docs/api');
      expect(getLocalizedPath('/es/products/cli', 'en')).toBe(
        '/en/products/cli'
      );
    });

    it('adds language prefix if not present', () => {
      expect(getLocalizedPath('/docs/api', 'en')).toBe('/en/docs/api');
      expect(getLocalizedPath('/products/cli', 'es')).toBe('/es/products/cli');
    });

    it('handles root path', () => {
      expect(getLocalizedPath('/en/', 'es')).toBe('/es/');
      expect(getLocalizedPath('/', 'en')).toBe('/en/');
    });
  });

  describe('getLangFromPath', () => {
    it('extracts language from path with language prefix', () => {
      expect(getLangFromPath('/en/docs/api')).toBe('en');
      expect(getLangFromPath('/es/docs/api')).toBe('es');
      expect(getLangFromPath('/ua/products/cli')).toBe('ua');
    });

    it('returns default language for paths without language prefix', () => {
      expect(getLangFromPath('/docs/api')).toBe('en');
      expect(getLangFromPath('/products/cli')).toBe('en');
      expect(getLangFromPath('/')).toBe('en');
    });

    it('returns default language for invalid language codes', () => {
      expect(getLangFromPath('/fr/docs/api')).toBe('en');
      expect(getLangFromPath('/de/products/cli')).toBe('en');
    });
  });

  describe('getStaticPathsForLocales', () => {
    it('returns paths for all supported locales', () => {
      const paths = getStaticPathsForLocales();
      expect(paths).toEqual([
        { params: { lang: 'en' } },
        { params: { lang: 'es' } },
        { params: { lang: 'ua' } }
      ]);
    });
  });
});
