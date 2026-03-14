import { GridSquare, type ResolvedTheme, useTheme } from '@tearleads/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsProvider.js';
import { useSelectorTileSize } from '../hooks/index.js';
import type { ThemeValue } from '../types/userSettings.js';
import { ThemePreview } from './ThemePreview.js';

const THEMES: ResolvedTheme[] = ['light', 'dark', 'tokyo-night', 'monochrome'];

export function ThemeSelector() {
  const { t } = useTranslation('common');
  const { resolvedTheme, setTheme } = useTheme();
  const { setSetting } = useSettings();

  const handleThemeChange = useCallback(
    (themeOption: ResolvedTheme) => {
      setTheme(themeOption);
      setSetting('theme', themeOption as ThemeValue);
    },
    [setTheme, setSetting]
  );

  const tileSize = useSelectorTileSize();
  const tileStyle = {
    width: `${tileSize}px`,
    minWidth: `${tileSize}px`
  };

  return (
    <div className="space-y-3">
      <p className="font-medium">{t('theme')}</p>
      <div
        className="flex gap-3 overflow-x-auto p-0.5 md:overflow-visible"
        data-testid="theme-selector-container"
      >
        {THEMES.map((themeOption) => (
          <GridSquare
            key={themeOption}
            onClick={() => handleThemeChange(themeOption)}
            selected={resolvedTheme === themeOption}
            data-testid={`theme-option-${themeOption}`}
            className="shrink-0"
            style={tileStyle}
          >
            <ThemePreview theme={themeOption} />
          </GridSquare>
        ))}
      </div>
    </div>
  );
}
