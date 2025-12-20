import { formatDate, type HealthData } from '@rapid/shared';
import { Bug, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { API_BASE_URL, api } from '@/lib/api';

export function DebugMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) {
    throw new Error('Test error from debug menu');
  }

  const fetchHealth = useCallback(async () => {
    try {
      setHealthLoading(true);
      setHealthError(null);
      const data = await api.health.get();
      setHealth(data);
    } catch (_err) {
      setHealthError('Failed to connect to API');
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && !health && !healthLoading) {
      fetchHealth();
    }
  }, [isOpen, health, healthLoading, fetchHealth]);

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="fixed bottom-28 right-4 z-50 h-10 w-10 rounded-full shadow-lg"
        onClick={() => setIsOpen(true)}
        aria-label="Open debug menu"
        data-testid="debug-menu-button"
      >
        <Bug className="h-5 w-5" />
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4">
          <button
            type="button"
            className="fixed inset-0 bg-black/50 cursor-default"
            onClick={() => setIsOpen(false)}
            aria-label="Close debug menu"
          />
          <div className="relative z-10 w-80 max-h-[80vh] overflow-y-auto rounded-lg border bg-background p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Debug Menu</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                aria-label="Close debug menu button"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-sm">
                  <span className="font-medium">Environment: </span>
                  <span className="text-muted-foreground">
                    {import.meta.env.MODE}
                  </span>
                </div>

                <div className="text-sm">
                  <span className="font-medium">Screen: </span>
                  <span className="text-muted-foreground">
                    {window.innerWidth} x {window.innerHeight}
                  </span>
                </div>

                <div className="text-sm">
                  <span className="font-medium">User Agent: </span>
                  <span className="text-muted-foreground text-xs break-all">
                    {navigator.userAgent}
                  </span>
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold mb-2">API Health</h3>
                <div className="text-sm mb-2">
                  <span className="font-medium">API URL: </span>
                  <span className="text-muted-foreground text-xs break-all">
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
                        {health.status === 'healthy'
                          ? 'Healthy'
                          : health.status}
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
                      <span className="text-muted-foreground">
                        Current Time
                      </span>
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

              <div className="border-t pt-3 space-y-2">
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
      )}
    </>
  );
}
