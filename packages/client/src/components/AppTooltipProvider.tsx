import { TooltipProvider } from '@rapid/ui';
import type { ReactNode } from 'react';
import { useSettings } from '@/db/SettingsProvider';

interface AppTooltipProviderProps {
  children: ReactNode;
}

export function AppTooltipProvider({ children }: AppTooltipProviderProps) {
  const { getSetting } = useSettings();
  const tooltipsEnabled = getSetting('tooltips') === 'enabled';

  if (!tooltipsEnabled) {
    return <>{children}</>;
  }

  return <TooltipProvider delayDuration={100}>{children}</TooltipProvider>;
}
