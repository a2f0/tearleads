import { GridSquare } from '@/components/ui/grid-square';
import type { SupportedLanguage } from '@/i18n';
import { loadLanguage, supportedLanguages, useTypedTranslation } from '@/i18n';

const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  es: 'Español',
  ua: 'Українська'
};

const LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
  ua: '🇺🇦'
};

export function LanguageSelector() {
  const { t, i18n } = useTypedTranslation('common');

  const handleLanguageChange = async (langCode: SupportedLanguage) => {
    await loadLanguage(langCode);
    i18n.changeLanguage(langCode);
  };

  return (
    <div className="space-y-3">
      <p className="font-medium">{t('language')}</p>
      <div
        className="flex gap-3 overflow-x-auto md:overflow-visible"
        data-testid="language-selector-container"
      >
        {supportedLanguages.map((langCode) => (
          <GridSquare
            key={langCode}
            onClick={() => handleLanguageChange(langCode)}
            selected={i18n.language === langCode}
            data-testid={`language-option-${langCode}`}
            className="w-[100px] shrink-0 md:w-[120px]"
          >
            <div className="flex h-full flex-col items-center justify-center gap-2 p-2">
              <span className="text-3xl">{LANGUAGE_FLAGS[langCode]}</span>
              <span className="font-medium text-sm">
                {LANGUAGE_NAMES[langCode]}
              </span>
            </div>
          </GridSquare>
        ))}
      </div>
    </div>
  );
}
