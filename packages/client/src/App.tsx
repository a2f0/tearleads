import { formatDate, type HealthData } from '@rapid/shared';
import { Moon, RefreshCw, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Footer } from '@/components/ui/footer';
import tearleadsLogo from '@/images/tearleads-logo-small.svg';

function App() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => {
      const newValue = !prev;
      document.documentElement.classList.toggle('dark', newValue);
      return newValue;
    });
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/health');

      if (!response.ok) {
        throw new Error('Failed to fetch health status');
      }

      const data: HealthData = await response.json();
      setHealth(data);
    } catch (_err) {
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

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

          <Card data-testid="api-health-card">
            <CardHeader>
              <CardTitle>API Health Check</CardTitle>
              <CardDescription>
                Current status of the backend API
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading && (
                <p className="text-sm text-muted-foreground">Loading...</p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              {!loading && !error && health && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="text-sm font-medium">Status</span>
                    <span className="text-sm text-green-600 font-semibold">
                      Healthy
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="text-sm font-medium">Timestamp</span>
                    <span className="text-sm text-muted-foreground">
                      {health.timestamp}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="text-sm font-medium">Uptime</span>
                    <span className="text-sm text-muted-foreground">
                      {health.uptime.toFixed(2)}s
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Current Time</span>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(new Date())}
                    </span>
                  </div>
                </div>
              )}
              <Button
                onClick={fetchHealth}
                disabled={loading}
                className="w-full"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {loading ? 'Refreshing...' : 'Refresh'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default App;
