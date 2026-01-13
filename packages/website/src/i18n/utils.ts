import type { SupportedLanguage } from './config';
import {
  defaultLanguage,
  isSupportedLanguage,
  supportedLanguages
} from './config';

/**
 * Generate localized path from current path.
 * Default language (en) has no prefix, other languages are prefixed.
 */
export function getLocalizedPath(
  currentPath: string,
  newLang: SupportedLanguage
): string {
  // Remove leading slash and split
  const parts = currentPath.replace(/^\//, '').split('/');

  // Remove existing language prefix if present
  if (isSupportedLanguage(parts[0])) {
    parts.shift();
  }

  // For default language, return path without prefix
  if (newLang === defaultLanguage) {
    return `/${parts.join('/')}`;
  }

  // For other languages, add prefix
  return `/${newLang}/${parts.join('/')}`;
}

/**
 * Extract language from path
 */
export function getLangFromPath(path: string): SupportedLanguage {
  const parts = path.replace(/^\//, '').split('/');
  if (isSupportedLanguage(parts[0])) {
    return parts[0];
  }
  return defaultLanguage;
}

/**
 * Generate static paths for non-default locales only.
 * Default locale pages are at root level.
 */
export function getStaticPathsForLocales() {
  return supportedLanguages
    .filter((lang) => lang !== defaultLanguage)
    .map((lang) => ({
      params: { lang }
    }));
}

/**
 * Generate href for a path in the given language.
 * Default language has no prefix, other languages are prefixed.
 */
export function getHref(path: string, lang: SupportedLanguage): string {
  if (lang === defaultLanguage) {
    return path;
  }
  return `/${lang}${path}`;
}
