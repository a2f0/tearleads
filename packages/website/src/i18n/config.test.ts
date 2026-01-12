import { describe, expect, it } from 'vitest';
import {
  defaultLanguage,
  isSupportedLanguage,
  LANGUAGE_FLAGS,
  LANGUAGE_NAMES,
  supportedLanguages
} from './config';

describe('i18n config', () => {
  it('exports supportedLanguages array', () => {
    expect(supportedLanguages).toEqual(['en', 'es', 'ua']);
  });

  it('exports defaultLanguage as en', () => {
    expect(defaultLanguage).toBe('en');
  });

  it('exports LANGUAGE_NAMES for all supported languages', () => {
    expect(LANGUAGE_NAMES.en).toBe('English');
    expect(LANGUAGE_NAMES.es).toBe('Español');
    expect(LANGUAGE_NAMES.ua).toBe('Українська');
  });

  it('exports LANGUAGE_FLAGS for all supported languages', () => {
    expect(LANGUAGE_FLAGS.en).toBe('🇺🇸');
    expect(LANGUAGE_FLAGS.es).toBe('🇪🇸');
    expect(LANGUAGE_FLAGS.ua).toBe('🇺🇦');
  });

  describe('isSupportedLanguage', () => {
    it('returns true for supported languages', () => {
      expect(isSupportedLanguage('en')).toBe(true);
      expect(isSupportedLanguage('es')).toBe(true);
      expect(isSupportedLanguage('ua')).toBe(true);
    });

    it('returns false for unsupported languages', () => {
      expect(isSupportedLanguage('fr')).toBe(false);
      expect(isSupportedLanguage('de')).toBe(false);
      expect(isSupportedLanguage('')).toBe(false);
      expect(isSupportedLanguage('EN')).toBe(false);
    });
  });
});
