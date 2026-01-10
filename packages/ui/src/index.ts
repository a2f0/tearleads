// Components
export {
  ConnectionIndicator,
  type ConnectionIndicatorProps,
  type ConnectionState
} from './components/connectionIndicator.js';
export { Footer, type FooterProps } from './components/footer.js';
export {
  ThemeSwitcher,
  type ThemeSwitcherProps
} from './components/themeSwitcher.js';

// Context
export {
  type ResolvedTheme,
  type Theme,
  ThemeProvider,
  type ThemeProviderProps
} from './context/themeProvider.js';
export { useTheme } from './context/useTheme.js';

// Utilities
export { cn } from './lib/utils.js';
