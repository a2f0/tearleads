/**
 * Unit tests for i18n module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  i18n,
  isSupportedLanguage,
  loadLanguage,
  supportedLanguages
} from './i18n';

describe('i18n', () => {
  describe('supportedLanguages', () => {
    it('includes en, es, and ua', () => {
      expect(supportedLanguages).toContain('en');
      expect(supportedLanguages).toContain('es');
      expect(supportedLanguages).toContain('ua');
    });

    it('has exactly 3 languages', () => {
      expect(supportedLanguages).toHaveLength(3);
    });
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

  describe('loadLanguage', () => {
    it('loads English without fetching (already loaded)', async () => {
      await expect(loadLanguage('en')).resolves.toBeUndefined();
    });
  });

  describe('i18n instance', () => {
    it('is initialized with default language en', () => {
      expect(i18n.language).toBeDefined();
    });

    it('has common namespace', () => {
      expect(i18n.hasResourceBundle('en', 'common')).toBe(true);
    });

    it('has menu namespace', () => {
      expect(i18n.hasResourceBundle('en', 'menu')).toBe(true);
    });
  });

  describe('settings-synced event', () => {
    let changeLanguageSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      changeLanguageSpy = vi.spyOn(i18n, 'changeLanguage');
    });

    afterEach(() => {
      changeLanguageSpy.mockRestore();
    });

    it('changes language when settings-synced event is dispatched', () => {
      const currentLang = i18n.language;
      const newLang = currentLang === 'es' ? 'ua' : 'es';

      window.dispatchEvent(
        new CustomEvent('settings-synced', {
          detail: { settings: { language: newLang } }
        })
      );

      expect(changeLanguageSpy).toHaveBeenCalledWith(newLang);
    });

    it('does not change language when same as current', () => {
      const currentLang = i18n.language || 'en';

      window.dispatchEvent(
        new CustomEvent('settings-synced', {
          detail: { settings: { language: currentLang } }
        })
      );

      expect(changeLanguageSpy).not.toHaveBeenCalled();
    });

    it('ignores unsupported language in settings-synced event', () => {
      window.dispatchEvent(
        new CustomEvent('settings-synced', {
          detail: { settings: { language: 'fr' } }
        })
      );

      expect(changeLanguageSpy).not.toHaveBeenCalled();
    });

    it('ignores settings-synced event without language', () => {
      window.dispatchEvent(
        new CustomEvent('settings-synced', {
          detail: { settings: { theme: 'dark' } }
        })
      );

      expect(changeLanguageSpy).not.toHaveBeenCalled();
    });

    it('ignores settings-synced event with empty language', () => {
      window.dispatchEvent(
        new CustomEvent('settings-synced', {
          detail: { settings: { language: '' } }
        })
      );

      expect(changeLanguageSpy).not.toHaveBeenCalled();
    });
  });
});
