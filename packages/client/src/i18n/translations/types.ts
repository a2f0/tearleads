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
  notes: string;
  audio: string;
  videos: string;
  tables: string;
  analytics: string;
  sqlite: string;
  console: string;
  debug: string;
  opfs: string;
  cacheStorage: string;
  localStorage: string;
  keychain: string;
  chat: string;
  models: string;
  admin: string;
  postgresAdmin: string;
  settings: string;
  email: string;
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
  download: string;
  share: string;
  edit: string;
  delete: string;
  restore: string;
  exportVCard: string;
  newNote: string;
}

export interface SettingsTranslations {
  font: string;
  fontDescription: string;
  fontSystem: string;
  fontMonospace: string;
  iconDepth: string;
  iconDepthDescription: string;
  iconDepthEmbossed: string;
  iconDepthDebossed: string;
  tooltips: string;
  tooltipsDescription: string;
  tooltipsEnabled: string;
  tooltipsDisabled: string;
}

export interface Translations {
  common: CommonTranslations;
  menu: MenuTranslations;
  audio: AudioTranslations;
  tooltips: TooltipsTranslations;
  contextMenu: ContextMenuTranslations;
  settings: SettingsTranslations;
}

export type I18NextTranslations = {
  common: CommonTranslations;
  menu: MenuTranslations;
  audio: AudioTranslations;
  tooltips: TooltipsTranslations;
  contextMenu: ContextMenuTranslations;
  settings: SettingsTranslations;
} & Record<string, Record<string, string>>;

export type CommonKeys = keyof CommonTranslations;
export type MenuKeys = keyof MenuTranslations;
export type AudioKeys = keyof AudioTranslations;
export type TooltipsKeys = keyof TooltipsTranslations;
export type ContextMenuKeys = keyof ContextMenuTranslations;
export type SettingsKeys = keyof SettingsTranslations;

export type NamespaceKeys = keyof Translations;

export type TranslationKeys<NS extends NamespaceKeys> = keyof Translations[NS];
