// Context providers

// Utilities
export { cn } from '@tearleads/ui';
// Components
export {
  BorderRadiusToggle,
  FontSelector,
  IconBackgroundToggle,
  IconDepthToggle,
  type LanguageConfig,
  LanguageSelector,
  type LanguageSelectorProps,
  PATTERN_LABELS,
  PatternPreview,
  type PatternPreviewProps,
  PatternSelector,
  SettingsSection,
  ThemePreview,
  type ThemePreviewProps,
  ThemeSelector,
  TooltipsToggle,
  WindowOpacityToggle
} from './components/index.js';
export {
  SettingsProvider,
  type SettingsProviderProps,
  useSettings,
  useSettingsOptional
} from './context/index.js';
// Hooks
export {
  useBorderRadiusEffect,
  useFontEffect,
  useWindowOpacityEffect
} from './hooks/index.js';
export { SettingsPage, type SettingsPageProps } from './pages/index.js';
// Types
export type {
  BorderRadiusValue,
  DesktopIconBackgroundValue,
  DesktopIconDepthValue,
  DesktopPatternValue,
  FontValue,
  LanguageValue,
  SettingsSyncedDetail,
  SettingValueMap,
  ThemeValue,
  TooltipsValue,
  UserSettingKey,
  WindowOpacityValue
} from './types/index.js';
export {
  BORDER_RADIUS_VALUES,
  DESKTOP_ICON_BACKGROUND_VALUES,
  DESKTOP_ICON_DEPTH_VALUES,
  dispatchSettingsSyncedEvent,
  getSettingFromStorage,
  isBorderRadiusValue,
  isDesktopIconBackgroundValue,
  isDesktopIconDepthValue,
  isDesktopPatternValue,
  isFontValue,
  isLanguageValue,
  isThemeValue,
  isTooltipsValue,
  isWindowOpacityValue,
  SETTING_DEFAULTS,
  SETTING_STORAGE_KEYS,
  setSettingInStorage,
  THEME_VALUES,
  WINDOW_OPACITY_VALUES
} from './types/index.js';
