import type { SupportedLanguage } from './config';
import {
  defaultLanguage,
  isSupportedLanguage,
  supportedLanguages
} from './config';

/**
 * Generate localized path from current path
 */
export function getLocalizedPath(
  currentPath: string,
  newLang: SupportedLanguage
): string {
  // Remove leading slash and split
  const parts = currentPath.replace(/^\//, '').split('/');

  // Check if first part is a language code
  if (isSupportedLanguage(parts[0])) {
    parts[0] = newLang;
  } else {
    parts.unshift(newLang);
  }

  return `/${parts.join('/')}`;
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
 * Generate static paths for all locales
 */
export function getStaticPathsForLocales() {
  return supportedLanguages.map((lang) => ({
    params: { lang }
  }));
}
