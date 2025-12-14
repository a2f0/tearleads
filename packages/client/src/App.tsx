import { Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DebugMenu } from '@/components/ui/debug-menu';
import { Footer } from '@/components/ui/footer';
import tearleadsLogo from '@/images/tearleads-logo-small.svg';

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('theme');
    if (stored) {
      return stored === 'dark';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => {
      const newDarkMode = !prev;
      localStorage.setItem('theme', newDarkMode ? 'dark' : 'light');
      return newDarkMode;
    });
  }, []);

  return (
    <div
      className="flex min-h-screen flex-col bg-background"
      data-testid="app-container"
    >
      <main className="flex-1 pb-20">
        <div className="container mx-auto px-4 py-16 max-w-2xl">
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={tearleadsLogo} alt="Tearleads" className="h-8 w-8" />
              <h1 className="text-4xl font-bold tracking-tight">Tearleads</h1>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleDarkMode}
              aria-label="Toggle dark mode"
            >
              {darkMode ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </main>
      <Footer />
      <DebugMenu />
    </div>
  );
}

export default App;
