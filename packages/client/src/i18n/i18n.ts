import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { en } from './translations/en';

export const supportedLanguages = ['en', 'es', 'ua'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

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
  if (supportedLanguages.includes(lang as SupportedLanguage)) {
    loadLanguage(lang as SupportedLanguage);
  }
});

const detectedLang = i18n.language;
if (
  detectedLang &&
  detectedLang !== 'en' &&
  supportedLanguages.includes(detectedLang as SupportedLanguage)
) {
  loadLanguage(detectedLang as SupportedLanguage);
}

export { i18n };
