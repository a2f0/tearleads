import { ThemeProvider } from '@rapid/ui';
import type { SupportedLanguage } from '../i18n/config';
import { SettingsButton } from './SettingsButton';

interface SettingsIslandProps {
  currentLang: SupportedLanguage;
}

export function SettingsIsland({ currentLang }: SettingsIslandProps) {
  return (
    <ThemeProvider>
      <SettingsButton currentLang={currentLang} />
    </ThemeProvider>
  );
}
