import type { ResolvedTheme } from '@rapid/ui';
import { useTheme } from '@rapid/ui';
import { GridSquare } from '@/components/ui/grid-square';
import { useTypedTranslation } from '@/i18n';
import { ThemePreview } from './ThemePreview';

const THEMES: ResolvedTheme[] = ['light', 'dark', 'tokyo-night'];

export function ThemeSelector() {
  const { t } = useTypedTranslation('common');
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{t('theme')}</p>
        <p className="text-muted-foreground text-sm">{t('themeDescription')}</p>
      </div>
      <div
        className="flex gap-3 overflow-x-auto md:overflow-visible"
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
