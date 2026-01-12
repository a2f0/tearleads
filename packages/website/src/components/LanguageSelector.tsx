import type { SupportedLanguage } from '../i18n/config';
import {
  LANGUAGE_FLAGS,
  LANGUAGE_NAMES,
  supportedLanguages
} from '../i18n/config';
import { getLocalizedPath } from '../i18n/utils';
import { GridSquare } from './GridSquare';

interface LanguageSelectorProps {
  currentLang: SupportedLanguage;
}

export function LanguageSelector({ currentLang }: LanguageSelectorProps) {
  const handleLanguageChange = (langCode: SupportedLanguage) => {
    // Persist to localStorage
    localStorage.setItem('language', langCode);

    // Navigate to equivalent page in new language
    const currentPath = window.location.pathname;
    const newPath = getLocalizedPath(currentPath, langCode);
    window.location.href = newPath;
  };

  return (
    <div className="space-y-3">
      <p className="font-medium">Language</p>
      <div
        className="flex gap-3 overflow-x-auto md:overflow-visible"
        data-testid="language-selector-container"
      >
        {supportedLanguages.map((langCode) => (
          <GridSquare
            key={langCode}
            onClick={() => handleLanguageChange(langCode)}
            selected={currentLang === langCode}
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
