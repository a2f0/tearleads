import { Settings } from 'lucide-react';
import { useState } from 'react';
import { SettingsModal } from './SettingsModal';

export function SettingsButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-9 items-center justify-center rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Settings"
        data-testid="settings-button"
      >
        <Settings className="h-5 w-5" />
      </button>

      <SettingsModal open={isOpen} onOpenChange={setIsOpen} />
    </>
  );
}
