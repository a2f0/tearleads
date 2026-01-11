import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ThemeSelector } from './ThemeSelector';

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      data-testid="settings-sheet"
    >
      <ThemeSelector />
    </BottomSheet>
  );
}
