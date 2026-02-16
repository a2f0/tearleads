import appConfig from 'virtual:app-config';
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import type { SettingsSyncedDetail } from '../db/userSettings';
import { en } from './translations/en';

export const supportedLanguages = ['en', 'es', 'ua', 'pt'] as const;
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
  i18n.addResourceBundle(lang, 'health', translations[lang].health, true, true);
  loadedLanguages.add(lang);
}

function applyAppOverrides(lang: string): void {
  if (appConfig.translations) {
    Object.entries(appConfig.translations).forEach(([key, value]) => {
      i18n.addResource(lang, 'common', key, value);
    });
  }
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
    showSupportNotice: false,

    interpolation: {
      escapeValue: false
    },

    lng: 'en',

    supportedLngs: supportedLanguages,

    ns: ['common', 'menu', 'health'],
    defaultNS: 'common',

    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage']
    },

    react: {
      useSuspense: false
    }
  });

// Apply app-specific translation overrides for initial languages
applyAppOverrides('en');
if (i18n.language && i18n.language !== 'en') {
  applyAppOverrides(i18n.language);
}

i18n.on('languageChanged', (lang) => {
  if (isSupportedLanguage(lang)) {
    loadLanguage(lang).then(() => {
      applyAppOverrides(lang);
    });
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
function handleSettingsSynced(event: CustomEvent<SettingsSyncedDetail>): void {
  const { language } = event.detail.settings;
  if (language && isSupportedLanguage(language) && language !== i18n.language) {
    i18n.changeLanguage(language);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'settings-synced',
    handleSettingsSynced as EventListener
  );
}

export { i18n };
