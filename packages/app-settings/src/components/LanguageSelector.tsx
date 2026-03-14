import { GridSquare } from '@tearleads/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsOptional } from '../context/SettingsProvider.js';
import type { LanguageValue } from '../types/userSettings.js';

export interface LanguageConfig {
  code: LanguageValue;
  name: string;
  flag: string;
}

export interface LanguageSelectorProps {
  /** List of supported languages */
  languages?: LanguageConfig[];
  /** Callback when language changes */
  onLanguageChange?: (langCode: LanguageValue) => void | Promise<void>;
}

const DEFAULT_LANGUAGES: LanguageConfig[] = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'ua', name: 'Українська', flag: '🇺🇦' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' }
];

export function LanguageSelector({
  languages = DEFAULT_LANGUAGES,
  onLanguageChange
}: LanguageSelectorProps) {
  const { t, i18n } = useTranslation('common');
  const settings = useSettingsOptional();

  const handleLanguageChange = useCallback(
    async (langCode: LanguageValue) => {
      if (onLanguageChange) {
        await onLanguageChange(langCode);
      }
      i18n.changeLanguage(langCode);
      settings?.setSetting('language', langCode);
    },
    [i18n, onLanguageChange, settings]
  );

  return (
    <div className="space-y-3">
      <p className="font-medium">{t('language')}</p>
      <div
        className="flex gap-3 overflow-x-auto md:overflow-visible"
        data-testid="language-selector-container"
      >
        {languages.map((lang) => (
          <GridSquare
            key={lang.code}
            onClick={() => handleLanguageChange(lang.code)}
            selected={i18n.language === lang.code}
            data-testid={`language-option-${lang.code}`}
            className="w-[100px] shrink-0 md:w-[120px]"
          >
            <div className="flex h-full flex-col items-center justify-center gap-2 p-2">
              <span className="text-3xl">{lang.flag}</span>
              <span className="font-medium text-sm">{lang.name}</span>
            </div>
          </GridSquare>
        ))}
      </div>
    </div>
  );
}
