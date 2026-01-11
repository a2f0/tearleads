import { ThemeProvider } from '@rapid/ui';
import { SettingsButton } from './SettingsButton';

export function SettingsIsland() {
  return (
    <ThemeProvider>
      <SettingsButton />
    </ThemeProvider>
  );
}
