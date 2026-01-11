import type { I18NextTranslations } from './types';

export const en = {
  common: {
    language: 'Language',
    languageName: 'English',
    selectLanguage: 'Select language',
    settings: 'Settings',
    theme: 'Theme',
    themeDescription: 'Choose your preferred color theme'
  },
  menu: {
    home: 'Home',
    files: 'Files',
    contacts: 'Contacts',
    photos: 'Photos',
    documents: 'Documents',
    audio: 'Audio',
    tables: 'Tables',
    analytics: 'Analytics',
    sqlite: 'SQLite',
    debug: 'Debug',
    opfs: 'OPFS',
    cacheStorage: 'Cache Storage',
    localStorage: 'Local Storage',
    keychain: 'Keychain',
    chat: 'Chat',
    models: 'Models',
    admin: 'Admin',
    settings: 'Settings'
  }
} as const satisfies I18NextTranslations;
