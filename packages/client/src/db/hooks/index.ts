// Re-export settings hooks from @tearleads/settings
export { useSettings, useSettingsOptional } from '@tearleads/settings';
// Export ClientSettingsProvider for use in main.tsx
export { ClientSettingsProvider } from '@/contexts/ClientSettingsProvider';
export { DatabaseProvider } from './useDatabase';
export {
  useDatabase,
  useDatabaseContext,
  useDatabaseOptional
} from './useDatabaseContext';
