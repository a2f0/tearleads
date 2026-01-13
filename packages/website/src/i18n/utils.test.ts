import { describe, expect, it } from 'vitest';
import {
  getHref,
  getLangFromPath,
  getLocalizedPath,
  getStaticPathsForLocales
} from './utils';

describe('i18n utils', () => {
  describe('getLocalizedPath', () => {
    it('adds language prefix for non-default languages', () => {
      expect(getLocalizedPath('/docs/api', 'es')).toBe('/es/docs/api');
      expect(getLocalizedPath('/docs/api', 'ua')).toBe('/ua/docs/api');
      expect(getLocalizedPath('/en/docs/api', 'es')).toBe('/es/docs/api');
    });

    it('removes language prefix for default language', () => {
      expect(getLocalizedPath('/es/products/cli', 'en')).toBe('/products/cli');
      expect(getLocalizedPath('/ua/docs/api', 'en')).toBe('/docs/api');
      expect(getLocalizedPath('/docs/api', 'en')).toBe('/docs/api');
    });

    it('handles root path', () => {
      expect(getLocalizedPath('/es/', 'en')).toBe('/');
      expect(getLocalizedPath('/', 'en')).toBe('/');
      expect(getLocalizedPath('/', 'es')).toBe('/es/');
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
    it('returns paths for non-default locales only', () => {
      const paths = getStaticPathsForLocales();
      expect(paths).toEqual([
        { params: { lang: 'es' } },
        { params: { lang: 'ua' } }
      ]);
    });
  });

  describe('getHref', () => {
    it('returns path without prefix for default language', () => {
      expect(getHref('/docs/api', 'en')).toBe('/docs/api');
      expect(getHref('/', 'en')).toBe('/');
    });

    it('returns path with prefix for non-default languages', () => {
      expect(getHref('/docs/api', 'es')).toBe('/es/docs/api');
      expect(getHref('/docs/api', 'ua')).toBe('/ua/docs/api');
      expect(getHref('/', 'es')).toBe('/es/');
    });
  });
});
