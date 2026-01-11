import { Dialog } from './Dialog';
import { ThemeSelector } from './ThemeSelector';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      data-testid="settings-modal"
    >
      <ThemeSelector />
    </Dialog>
  );
}
