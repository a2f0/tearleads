import { Settings } from 'lucide-react';
import { useState } from 'react';
import { SettingsSheet } from './settings/SettingsSheet';

export function SettingsButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-9 items-center justify-center rounded-md px-2 hover:bg-accent hover:text-accent-foreground"
        aria-label="Settings"
        data-testid="settings-button"
      >
        <Settings className="h-5 w-5" />
      </button>

      <SettingsSheet open={isOpen} onOpenChange={setIsOpen} />
    </>
  );
}
