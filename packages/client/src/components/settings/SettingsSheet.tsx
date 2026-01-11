import { BottomSheet } from '@/components/ui/bottom-sheet';
import { useTypedTranslation } from '@/i18n';
import { LanguageSelector } from './LanguageSelector';
import { ThemeSelector } from './ThemeSelector';

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const { t } = useTypedTranslation('common');

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings')}
      data-testid="settings-sheet"
    >
      <div className="space-y-6">
        <ThemeSelector />
        <LanguageSelector />
      </div>
    </BottomSheet>
  );
}
