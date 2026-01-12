import { Dialog, ThemeSelector } from '@rapid/ui';
import type { SupportedLanguage } from '../i18n/config';
import { LanguageSelector } from './LanguageSelector';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLang: SupportedLanguage;
}

export function SettingsModal({
  open,
  onOpenChange,
  currentLang
}: SettingsModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      data-testid="settings-modal"
    >
      <div className="space-y-6">
        <ThemeSelector />
        <LanguageSelector currentLang={currentLang} />
      </div>
    </Dialog>
  );
}
