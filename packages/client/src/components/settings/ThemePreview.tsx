import type { ResolvedTheme } from '@rapid/ui';

export interface ThemePreviewProps {
  theme: ResolvedTheme;
}

const THEME_COLORS: Record<
  ResolvedTheme,
  { background: string; foreground: string; primary: string; muted: string }
> = {
  light: {
    background: '#ffffff',
    foreground: '#0a0a0a',
    primary: '#4f46e5',
    muted: '#f5f5f5'
  },
  dark: {
    background: '#0a0a0a',
    foreground: '#fafafa',
    primary: '#6366f1',
    muted: '#262626'
  },
  'tokyo-night': {
    background: '#24283b',
    foreground: '#c0caf5',
    primary: '#7aa2f7',
    muted: '#414868'
  }
};

const THEME_LABELS: Record<ResolvedTheme, string> = {
  light: 'Light',
  dark: 'Dark',
  'tokyo-night': 'Tokyo Night'
};

export function ThemePreview({ theme }: ThemePreviewProps) {
  const colors = THEME_COLORS[theme];

  return (
    <div
      className="flex h-full w-full flex-col p-2"
      style={{ backgroundColor: colors.background }}
    >
      <div
        className="mb-2 h-3 w-full rounded-sm"
        style={{ backgroundColor: colors.muted }}
      />

      <div className="flex-1 space-y-1.5">
        <div
          className="h-2 w-3/4 rounded-sm"
          style={{ backgroundColor: colors.foreground, opacity: 0.7 }}
        />
        <div
          className="h-2 w-1/2 rounded-sm"
          style={{ backgroundColor: colors.foreground, opacity: 0.5 }}
        />
      </div>

      <div
        className="mt-auto h-4 w-full rounded-sm"
        style={{ backgroundColor: colors.primary }}
      />

      <p
        className="mt-2 text-center font-medium text-xs"
        style={{ color: colors.foreground }}
      >
        {THEME_LABELS[theme]}
      </p>
    </div>
  );
}
