import { Settings } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useWindowManagerActions } from '@/contexts/WindowManagerContext';
import { useIsMobile } from '@/hooks/device';
import { SettingsSheet } from './settings/SettingsSheet';

export function SettingsButton() {
  const [isOpen, setIsOpen] = useState(false);
  const isMobile = useIsMobile();
  const { openWindow } = useWindowManagerActions();

  const handleClick = useCallback(() => {
    if (isMobile) {
      setIsOpen(true);
      return;
    }

    // openWindow handles focusing existing windows of the same type
    openWindow('settings');
  }, [isMobile, openWindow]);

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex h-9 items-center justify-center rounded-md px-2 hover:bg-accent hover:text-accent-foreground"
        aria-label="Settings"
        data-testid="settings-button"
      >
        <Settings className="h-5 w-5" />
      </button>

      {isMobile && <SettingsSheet open={isOpen} onOpenChange={setIsOpen} />}
    </>
  );
}
