// Re-export settings components from @tearleads/settings
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
} from '@tearleads/settings';

// Client-specific components (not in @tearleads/settings)
export { DisplayPropertiesWindow } from './DisplayPropertiesWindow';
export { FeatureFlags } from './FeatureFlags';
export { SettingsSheet } from './SettingsSheet';
