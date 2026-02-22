export * from './translationTypesCore';
export * from './translationTypesFeatures';

import type {
  AudioTranslations,
  ClassicTranslations,
  CommonTranslations,
  ContextMenuTranslations,
  MenuTranslations,
  SettingsTranslations,
  TooltipsTranslations
} from './translationTypesCore';
import type {
  AdminTranslations,
  ContactsTranslations,
  DebugTranslations,
  HealthTranslations,
  SearchTranslations,
  SyncTranslations,
  VehiclesTranslations
} from './translationTypesFeatures';

export interface Translations {
  common: CommonTranslations;
  menu: MenuTranslations;
  audio: AudioTranslations;
  tooltips: TooltipsTranslations;
  contextMenu: ContextMenuTranslations;
  settings: SettingsTranslations;
  classic: ClassicTranslations;
  contacts: ContactsTranslations;
  sync: SyncTranslations;
  debug: DebugTranslations;
  search: SearchTranslations;
  vehicles: VehiclesTranslations;
  admin: AdminTranslations;
  health: HealthTranslations;
}

type TranslationValue = string | Record<string, string>;

export type I18NextTranslations = {
  common: CommonTranslations;
  menu: MenuTranslations;
  audio: AudioTranslations;
  tooltips: TooltipsTranslations;
  contextMenu: ContextMenuTranslations;
  settings: SettingsTranslations;
  classic: ClassicTranslations;
  contacts: ContactsTranslations;
  sync: SyncTranslations;
  debug: DebugTranslations;
  search: SearchTranslations;
  vehicles: VehiclesTranslations;
  admin: AdminTranslations;
  health: HealthTranslations;
} & Record<string, Record<string, TranslationValue>>;

export type AdminKeys = keyof AdminTranslations;
export type MenuKeys = keyof MenuTranslations;

export type NamespaceKeys = keyof Translations;

export type TranslationKeys<NS extends NamespaceKeys> = keyof Translations[NS];
