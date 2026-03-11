import appConfig from 'virtual:app-config';
import type { SettingsSyncedDetail } from '@tearleads/app-settings';
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { en } from './translations/en';

export const supportedLanguages = ['en', 'es', 'ua', 'pt'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return supportedLanguages.some((supported) => supported === lang);
}

const loadedLanguages = new Set<string>(['en']);

type DetectedLanguageLoader = (lang: SupportedLanguage) => Promise<void>;

export async function loadLanguage(lang: SupportedLanguage): Promise<void> {
  if (loadedLanguages.has(lang)) return;

  const loaders: Record<
    string,
    () => Promise<{ [key: string]: Record<string, unknown> }>
  > = {
    es: () => import('./translations/es'),
    ua: () => import('./translations/ua'),
    pt: () => import('./translations/pt')
  };
  const loader = loaders[lang];
  if (!loader) return;
  const translations = await loader();
  const namespaces = [
    'common',
    'menu',
    'health',
    'contacts',
    'admin',
    'sync',
    'audio',
    'settings',
    'classic',
    'debug',
    'search',
    'vehicles',
    'contextMenu',
    'tooltips'
  ];

  const langBundle = translations[lang] as Record<string, unknown> | undefined;
  if (!langBundle) return;

  for (const ns of namespaces) {
    if (langBundle[ns]) {
      i18n.addResourceBundle(lang, ns, langBundle[ns], true, true);
    }
  }

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

    ns: [
      'common',
      'menu',
      'audio',
      'tooltips',
      'contextMenu',
      'settings',
      'classic',
      'contacts',
      'sync',
      'debug',
      'search',
      'vehicles',
      'admin',
      'health'
    ],
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

// Listen for settings-synced event from SettingsProvider (database sync)
function handleSettingsSynced(event: CustomEvent<SettingsSyncedDetail>): void {
  const { language } = event.detail.settings;
  if (language && isSupportedLanguage(language) && language !== i18n.language) {
    i18n.changeLanguage(language);
  }
}

type SettingsSyncedListenerTarget = {
  addEventListener: (type: string, listener: EventListener) => void;
};

export function registerSettingsSyncedListener(
  target: SettingsSyncedListenerTarget | undefined = typeof window !==
  'undefined'
    ? window
    : undefined
): void {
  if (!target) {
    return;
  }

  target.addEventListener(
    'settings-synced',
    handleSettingsSynced as EventListener
  );
}

export async function loadDetectedLanguage(
  detectedLanguage: string | undefined = i18n.language,
  languageLoader: DetectedLanguageLoader = loadLanguage
): Promise<void> {
  if (
    detectedLanguage &&
    detectedLanguage !== 'en' &&
    isSupportedLanguage(detectedLanguage)
  ) {
    await languageLoader(detectedLanguage);
  }
}

void loadDetectedLanguage();
registerSettingsSyncedListener();

export { i18n };
