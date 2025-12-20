import { useTheme } from '@rapid/ui';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppVersion } from '@/hooks/useAppVersion';
import { cn } from '@/lib/utils';

export function Settings() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const version = useAppVersion();

  const handleToggle = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <div className="flex min-h-screen flex-col bg-background safe-area-inset">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="mb-8 flex items-center gap-4">
          <Link
            to="/"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">Dark Mode</p>
              <p className="text-sm text-muted-foreground">
                Toggle dark mode on or off
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isDark}
              aria-label="Toggle dark mode"
              data-testid="dark-mode-switch"
              onClick={handleToggle}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                isDark ? 'bg-primary' : 'bg-input'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out',
                  isDark ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p
            className="text-xs text-muted-foreground/70"
            data-testid="app-version"
          >
            v{version ?? 'unknown'}
          </p>
        </div>
      </div>
    </div>
  );
}
