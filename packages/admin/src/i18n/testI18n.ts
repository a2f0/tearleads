import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { adminTestEn } from './translations/adminTestEn';

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: adminTestEn
    },
    ns: ['admin', 'common', 'contextMenu'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  });
}

export { i18n };
