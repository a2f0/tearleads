import { Activity } from 'lucide-react';
import { useState } from 'react';
import { HUD } from './HUD';

export function HUDTrigger() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Open HUD"
        title="Head's Up Display"
      >
        <Activity className="h-4 w-4" />
      </button>
      <HUD isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
