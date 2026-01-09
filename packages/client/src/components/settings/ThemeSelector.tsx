import type { ResolvedTheme } from '@rapid/ui';
import { useTheme } from '@rapid/ui';
import { GridSquare } from '@/components/ui/grid-square';
import { ThemePreview } from './ThemePreview';

const THEMES: ResolvedTheme[] = ['light', 'dark', 'tokyo-night'];

export function ThemeSelector() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">Theme</p>
        <p className="text-muted-foreground text-sm">
          Choose your preferred color theme
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2" data-testid="theme-selector-grid">
        {THEMES.map((t) => (
          <GridSquare
            key={t}
            onClick={() => setTheme(t)}
            selected={resolvedTheme === t}
            data-testid={`theme-option-${t}`}
            className="max-w-[200px]"
          >
            <ThemePreview theme={t} />
          </GridSquare>
        ))}
      </div>
    </div>
  );
}
