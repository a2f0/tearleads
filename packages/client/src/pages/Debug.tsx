import { formatDate, type HealthData } from '@rapid/shared';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { API_BASE_URL, api } from '@/lib/api';
import { detectPlatform } from '@/lib/utils';

export function Debug() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [shouldThrow, setShouldThrow] = useState(false);
  const [screenSize, setScreenSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight
  });

  if (shouldThrow) {
    throw new Error('Test error from debug menu');
  }

  const fetchHealth = useCallback(async () => {
    try {
      setHealthLoading(true);
      setHealthError(null);
      const data = await api.health.get();
      setHealth(data);
    } catch (err) {
      console.error('Failed to fetch API health:', err);
      setHealthError('Failed to connect to API');
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!health && !healthLoading) {
      fetchHealth();
    }
  }, [health, healthLoading, fetchHealth]);

  useEffect(() => {
    const handleResize = () => {
      setScreenSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
          <h1 className="text-2xl font-bold tracking-tight">Debug</h1>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border p-4 space-y-3">
            <h2 className="font-medium">Environment Info</h2>
            <div className="text-sm">
              <span className="font-medium">Environment: </span>
              <span className="text-muted-foreground">
                {import.meta.env.MODE}
              </span>
            </div>
            <div className="text-sm">
              <span className="font-medium">Screen: </span>
              <span className="text-muted-foreground">
                {screenSize.width} x {screenSize.height}
              </span>
            </div>
            <div className="text-sm">
              <span className="font-medium">User Agent: </span>
              <span className="text-muted-foreground text-xs break-all">
                {navigator.userAgent}
              </span>
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <h2 className="font-medium">Device Info</h2>
            <div className="text-sm">
              <span className="font-medium">Platform: </span>
              <span className="text-muted-foreground">{detectPlatform()}</span>
            </div>
            <div className="text-sm">
              <span className="font-medium">Pixel Ratio: </span>
              <span className="text-muted-foreground">
                {window.devicePixelRatio}x
              </span>
            </div>
            <div className="text-sm">
              <span className="font-medium">Online: </span>
              <span className="text-muted-foreground">
                {navigator.onLine ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="text-sm">
              <span className="font-medium">Language: </span>
              <span className="text-muted-foreground">
                {navigator.language}
              </span>
            </div>
            <div className="text-sm">
              <span className="font-medium">Touch Support: </span>
              <span className="text-muted-foreground">
                {'ontouchstart' in window ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="text-sm">
              <span className="font-medium">Standalone: </span>
              <span className="text-muted-foreground">
                {window.matchMedia('(display-mode: standalone)').matches
                  ? 'Yes'
                  : 'No'}
              </span>
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <h2 className="font-medium">API Health</h2>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">API URL</span>
              <span className="text-xs break-all max-w-[200px] text-right">
                {API_BASE_URL || '(not set)'}
              </span>
            </div>
            {healthLoading && (
              <p className="text-sm text-muted-foreground">Loading...</p>
            )}
            {healthError && (
              <p className="text-sm text-destructive">{healthError}</p>
            )}
            {!healthLoading && !healthError && health && (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span
                    className={
                      health.status === 'healthy'
                        ? 'text-green-600 font-medium'
                        : 'text-red-600 font-medium'
                    }
                  >
                    {health.status === 'healthy' ? 'Healthy' : health.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timestamp</span>
                  <span>{health.timestamp}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Uptime</span>
                  <span>{health.uptime.toFixed(2)}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Time</span>
                  <span>{formatDate(new Date())}</span>
                </div>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2"
              onClick={fetchHealth}
              disabled={healthLoading}
            >
              <RefreshCw className="mr-2 h-3 w-3" />
              {healthLoading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <h2 className="font-medium">Actions</h2>
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
            >
              Clear Local Storage
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={() => setShouldThrow(true)}
              data-testid="throw-error-button"
            >
              Throw Error
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
