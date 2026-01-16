import { TooltipProvider } from '@rapid/ui';
import type { ReactNode } from 'react';
import { useSettings } from '@/db/SettingsProvider';

interface AppTooltipProviderProps {
  children: ReactNode;
}

export function AppTooltipProvider({ children }: AppTooltipProviderProps) {
  const { getSetting } = useSettings();
  const tooltipsEnabled = getSetting('tooltips') === 'enabled';

  // Always render TooltipProvider - components like ConnectionIndicator use Tooltip
  // internally and require the provider to exist. Use a very long delay to effectively
  // disable tooltips when the setting is off.
  return (
    <TooltipProvider delayDuration={tooltipsEnabled ? 100 : 999999}>
      {children}
    </TooltipProvider>
  );
}
