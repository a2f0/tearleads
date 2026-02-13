import { GridSquare, type ResolvedTheme, useTheme } from '@tearleads/ui';
import { useTypedTranslation } from '@/i18n';
import { ThemePreview } from './ThemePreview';

const THEMES: ResolvedTheme[] = ['light', 'dark', 'tokyo-night', 'monochrome'];

export function ThemeSelector() {
  const { t } = useTypedTranslation('common');
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="space-y-3">
      <p className="font-medium">{t('theme')}</p>
      <div
        className="flex gap-3 overflow-x-auto p-0.5 md:overflow-visible"
        data-testid="theme-selector-container"
      >
        {THEMES.map((t) => (
          <GridSquare
            key={t}
            onClick={() => setTheme(t)}
            selected={resolvedTheme === t}
            data-testid={`theme-option-${t}`}
            className="w-[100px] shrink-0 md:w-[200px]"
          >
            <ThemePreview theme={t} />
          </GridSquare>
        ))}
      </div>
    </div>
  );
}
