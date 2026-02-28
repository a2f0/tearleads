import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

// Initialize i18n for tests
i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['contacts', 'contextMenu', 'common'],
  defaultNS: 'common',
  resources: {
    en: {
      contacts: {},
      contextMenu: {},
      common: {}
    }
  },
  interpolation: {
    escapeValue: false
  },
  react: {
    useSuspense: false
  },
  showSupportNotice: false
});

failOnConsole();

afterEach(() => {
  cleanup();
});
// trigger CI push
