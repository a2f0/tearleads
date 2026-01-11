import type { ResolvedTheme } from '../context/themeProvider.js';
import { useTheme } from '../context/useTheme.js';
import { cn } from '../lib/utils.js';
import { ThemePreview } from './themePreview.js';

const THEMES: ResolvedTheme[] = ['light', 'dark', 'tokyo-night'];

export function ThemeSelector() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="space-y-3">
      <p className="font-medium">Theme</p>
      <div className="flex gap-3" data-testid="theme-selector-container">
        {THEMES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTheme(t)}
            className={cn(
              'h-24 w-24 overflow-hidden rounded-lg border-2 transition-all',
              'hover:border-primary/50',
              resolvedTheme === t
                ? 'border-primary ring-2 ring-primary/20'
                : 'border-border'
            )}
            data-testid={`theme-option-${t}`}
          >
            <ThemePreview theme={t} />
          </button>
        ))}
      </div>
    </div>
  );
}
