export const supportedLanguages = ['en', 'es', 'ua', 'pt'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const defaultLanguage: SupportedLanguage = 'en';

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  es: 'Español',
  ua: 'Українська',
  pt: 'Português'
};

export const LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
  ua: '🇺🇦',
  pt: '🇵🇹'
};

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return supportedLanguages.some((supported) => supported === lang);
}
