import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { en } from './translations/en';

export const supportedLanguages = ['en', 'es', 'ua'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return supportedLanguages.some((supported) => supported === lang);
}

const loadedLanguages = new Set<string>(['en']);

export async function loadLanguage(lang: SupportedLanguage): Promise<void> {
  if (loadedLanguages.has(lang)) return;

  const translations = await import(`./translations/${lang}.ts`);
  i18n.addResourceBundle(lang, 'common', translations[lang].common, true, true);
  i18n.addResourceBundle(lang, 'menu', translations[lang].menu, true, true);
  loadedLanguages.add(lang);
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en
    },
    fallbackLng: 'en',
    debug: false,

    interpolation: {
      escapeValue: false
    },

    lng: 'en',

    supportedLngs: supportedLanguages,

    ns: ['common', 'menu'],
    defaultNS: 'common',

    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage']
    },

    react: {
      useSuspense: false
    }
  });

i18n.on('languageChanged', (lang) => {
  if (isSupportedLanguage(lang)) {
    loadLanguage(lang);
  }
});

const detectedLang = i18n.language;
if (
  detectedLang &&
  detectedLang !== 'en' &&
  isSupportedLanguage(detectedLang)
) {
  loadLanguage(detectedLang);
}

// Listen for settings-synced event from SettingsProvider (database sync)
if (typeof window !== 'undefined') {
  window.addEventListener('settings-synced', ((
    event: CustomEvent<{ settings: { language?: string } }>
  ) => {
    const { settings } = event.detail;
    if (
      settings.language &&
      isSupportedLanguage(settings.language) &&
      settings.language !== i18n.language
    ) {
      i18n.changeLanguage(settings.language);
    }
  }) as EventListener);
}

export { i18n };
