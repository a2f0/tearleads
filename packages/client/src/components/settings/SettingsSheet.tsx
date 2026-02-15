import { LanguageSelector, ThemeSelector } from '@tearleads/settings';
import { BottomSheet } from '@/components/ui/bottomSheet';
import { useTypedTranslation } from '@/i18n';

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
      fitContent
      maxHeightPercent={1}
    >
      <div className="space-y-6">
        <ThemeSelector />
        <LanguageSelector />
      </div>
    </BottomSheet>
  );
}
