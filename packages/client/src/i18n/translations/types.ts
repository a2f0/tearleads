export interface CommonTranslations {
  language: string;
  languageName: string;
  selectLanguage: string;
  settings: string;
  theme: string;
  themeDescription: string;
}

export interface MenuTranslations {
  home: string;
  files: string;
  contacts: string;
  photos: string;
  documents: string;
  audio: string;
  tables: string;
  analytics: string;
  sqlite: string;
  debug: string;
  opfs: string;
  cacheStorage: string;
  localStorage: string;
  keychain: string;
  chat: string;
  models: string;
  admin: string;
  settings: string;
}

export interface Translations {
  common: CommonTranslations;
  menu: MenuTranslations;
}

export type I18NextTranslations = {
  common: CommonTranslations;
  menu: MenuTranslations;
} & Record<string, Record<string, string>>;

export type CommonKeys = keyof CommonTranslations;
export type MenuKeys = keyof MenuTranslations;

export type NamespaceKeys = keyof Translations;

export type TranslationKeys<NS extends NamespaceKeys> = keyof Translations[NS];
