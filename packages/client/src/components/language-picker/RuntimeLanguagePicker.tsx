import { Check, Flag, Type } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import type { SupportedLanguage } from '@/i18n';
import { loadLanguage, supportedLanguages, useTypedTranslation } from '@/i18n';

const DISPLAY_MODE_KEY = 'language-picker-display-mode';
type DisplayMode = 'flag' | 'abbreviation';

const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  es: 'Español',
  ua: 'Українська',
  pt: 'Português'
};

const LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
  ua: '🇺🇦',
  pt: '🇵🇹'
};

function resolveCurrentLanguage(
  language: string | undefined
): SupportedLanguage {
  if (!language) {
    return 'en';
  }

  const normalizedLanguage = language.toLowerCase();
  if (normalizedLanguage === 'uk' || normalizedLanguage.startsWith('uk-')) {
    return 'ua';
  }

  const matchedLanguage = supportedLanguages.find(
    (supportedLanguage) =>
      normalizedLanguage === supportedLanguage ||
      normalizedLanguage.startsWith(`${supportedLanguage}-`)
  );

  return matchedLanguage ?? 'en';
}

function getInitialDisplayMode(): DisplayMode {
  const stored = localStorage.getItem(DISPLAY_MODE_KEY);
  if (stored === 'flag' || stored === 'abbreviation') {
    return stored;
  }
  return 'flag';
}

export function RuntimeLanguagePicker() {
  const { t, i18n } = useTypedTranslation('common');
  const [isOpen, setIsOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    getInitialDisplayMode
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeLanguage = useMemo(
    () => resolveCurrentLanguage(i18n.resolvedLanguage ?? i18n.language),
    [i18n.language, i18n.resolvedLanguage]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (containerRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleLanguageChange = useCallback(
    async (languageCode: SupportedLanguage) => {
      try {
        await loadLanguage(languageCode);
        await i18n.changeLanguage(languageCode);
        setIsOpen(false);
      } catch {
        // Keep the menu open so the user can retry if loading fails.
      }
    },
    [i18n]
  );

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const handleToggleDisplayMode = useCallback(() => {
    const newMode = displayMode === 'flag' ? 'abbreviation' : 'flag';
    setDisplayMode(newMode);
    localStorage.setItem(DISPLAY_MODE_KEY, newMode);
    setContextMenu(null);
  }, [displayMode]);

  return (
    <div
      ref={containerRef}
      className="relative"
      data-testid="runtime-language-picker"
    >
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        onContextMenu={handleContextMenu}
        className="inline-flex h-6 items-center gap-1 rounded-md bg-background/95 px-2 font-medium text-[11px] uppercase transition-colors hover:bg-accent"
        aria-label={t('selectLanguage')}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        data-testid="runtime-language-picker-trigger"
      >
        {displayMode === 'flag' ? (
          <span className="text-sm">{LANGUAGE_FLAGS[activeLanguage]}</span>
        ) : (
          <span>{activeLanguage.toUpperCase()}</span>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 bottom-full mb-2 min-w-40 rounded-md border bg-background p-1 shadow-lg"
          data-testid="runtime-language-picker-menu"
        >
          <p className="px-2 py-1 text-muted-foreground text-xs">
            {t('selectLanguage')}
          </p>
          {supportedLanguages.map((languageCode) => (
            <button
              key={languageCode}
              type="button"
              role="menuitemradio"
              aria-checked={activeLanguage === languageCode}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
              onClick={() => void handleLanguageChange(languageCode)}
              data-testid={`runtime-language-option-${languageCode}`}
            >
              <span className="w-5 text-base">
                {LANGUAGE_FLAGS[languageCode]}
              </span>
              <span className="flex-1">{LANGUAGE_NAMES[languageCode]}</span>
              {activeLanguage === languageCode && (
                <Check className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <ContextMenuItem
            icon={
              displayMode === 'flag' ? (
                <Type className="h-4 w-4" />
              ) : (
                <Flag className="h-4 w-4" />
              )
            }
            onClick={handleToggleDisplayMode}
            data-testid="toggle-display-mode"
          >
            {displayMode === 'flag' ? t('showAbbreviation') : t('showFlag')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
