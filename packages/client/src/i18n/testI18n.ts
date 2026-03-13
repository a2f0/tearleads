import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './translations/en';

if (!i18n.isInitialized) {
  const initialization = i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en
    },
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
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    },
    showSupportNotice: false
  });

  initialization.catch((error: unknown) => {
    console.error('Failed to initialize client test i18n', error);
  });
}
