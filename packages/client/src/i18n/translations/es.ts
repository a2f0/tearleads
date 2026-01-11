import type { I18NextTranslations } from './types';

export const es = {
  common: {
    language: 'Idioma',
    languageName: 'Español',
    selectLanguage: 'Seleccionar idioma',
    settings: 'Configuración',
    theme: 'Tema',
    themeDescription: 'Elija su tema de color preferido'
  },
  menu: {
    home: 'Inicio',
    files: 'Archivos',
    contacts: 'Contactos',
    photos: 'Fotos',
    documents: 'Documentos',
    audio: 'Audio',
    tables: 'Tablas',
    analytics: 'Analíticas',
    sqlite: 'SQLite',
    debug: 'Depuración',
    opfs: 'OPFS',
    cacheStorage: 'Caché',
    localStorage: 'Almacenamiento Local',
    keychain: 'Llavero',
    chat: 'Chat',
    models: 'Modelos',
    admin: 'Admin',
    settings: 'Configuración'
  }
} as const satisfies I18NextTranslations;
