import type { PingData } from '@rapid/shared';
import { Bug, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { API_BASE_URL, api } from '@/lib/api';

export function DebugMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [ping, setPing] = useState<PingData | null>(null);
  const [pingLoading, setPingLoading] = useState(false);
  const [pingError, setPingError] = useState<string | null>(null);
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) {
    throw new Error('Test error from debug menu');
  }

  const fetchPing = useCallback(async () => {
    try {
      setPingLoading(true);
      setPingError(null);
      const data = await api.ping.get();
      setPing(data);
    } catch (_err) {
      setPingError('Failed to connect to API');
    } finally {
      setPingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && !ping && !pingLoading) {
      fetchPing();
    }
  }, [isOpen, ping, pingLoading, fetchPing]);

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
                <h3 className="text-sm font-semibold mb-2">API Status</h3>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">API URL</span>
                  <span className="text-xs break-all max-w-45 text-right">
                    {API_BASE_URL || '(not set)'}
                  </span>
                </div>
                {pingLoading && (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                )}
                {pingError && (
                  <p className="text-sm text-destructive">{pingError}</p>
                )}
                {!pingLoading && !pingError && ping && (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Version</span>
                      <span className="text-green-600 font-medium">
                        {ping.version}
                      </span>
                    </div>
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={fetchPing}
                  disabled={pingLoading}
                >
                  <RefreshCw className="mr-2 h-3 w-3" />
                  {pingLoading ? 'Refreshing...' : 'Refresh'}
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
