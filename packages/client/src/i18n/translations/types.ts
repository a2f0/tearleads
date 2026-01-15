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
  videos: string;
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

export interface AudioTranslations {
  play: string;
  pause: string;
  previousTrack: string;
  nextTrack: string;
  restart: string;
  rewind: string;
  close: string;
  repeatOff: string;
  repeatAll: string;
  repeatOne: string;
}

export interface TooltipsTranslations {
  sseConnected: string;
  sseConnecting: string;
  sseDisconnected: string;
  keychainSalt: string;
  keychainKeyCheckValue: string;
  keychainSessionWrappingKey: string;
  keychainSessionWrappedKey: string;
}

export interface ContextMenuTranslations {
  play: string;
  pause: string;
  getInfo: string;
  viewDetails: string;
  delete: string;
}

export interface Translations {
  common: CommonTranslations;
  menu: MenuTranslations;
  audio: AudioTranslations;
  tooltips: TooltipsTranslations;
  contextMenu: ContextMenuTranslations;
}

export type I18NextTranslations = {
  common: CommonTranslations;
  menu: MenuTranslations;
  audio: AudioTranslations;
  tooltips: TooltipsTranslations;
  contextMenu: ContextMenuTranslations;
} & Record<string, Record<string, string>>;

export type CommonKeys = keyof CommonTranslations;
export type MenuKeys = keyof MenuTranslations;
export type AudioKeys = keyof AudioTranslations;
export type TooltipsKeys = keyof TooltipsTranslations;
export type ContextMenuKeys = keyof ContextMenuTranslations;

export type NamespaceKeys = keyof Translations;

export type TranslationKeys<NS extends NamespaceKeys> = keyof Translations[NS];
