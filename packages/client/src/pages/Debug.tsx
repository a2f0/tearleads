import type { PingData } from '@rapid/shared';
import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { API_BASE_URL, api } from '@/lib/api';
import { cn, detectPlatform } from '@/lib/utils';

function InfoRow({
  label,
  value,
  valueClassName
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex gap-1 text-sm">
      <span className="shrink-0 font-medium">{label}: </span>
      <span
        className={cn(
          'wrap-break-word min-w-0 text-muted-foreground',
          valueClassName
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function Debug() {
  const [ping, setPing] = useState<PingData | null>(null);
  const [pingLoading, setPingLoading] = useState(false);
  const [pingError, setPingError] = useState<string | null>(null);
  const [shouldThrow, setShouldThrow] = useState(false);
  const [screenSize, setScreenSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight
  });

  if (shouldThrow) {
    throw new Error('Test error from debug menu');
  }

  const fetchPing = useCallback(async () => {
    try {
      setPingLoading(true);
      setPingError(null);
      const data = await api.ping.get();
      setPing(data);
    } catch (err) {
      console.error('Failed to fetch API ping:', err);
      setPingError('Failed to connect to API');
    } finally {
      setPingLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPing();
  }, [fetchPing]);

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
    <div className="space-y-6 overflow-x-hidden">
      <h1 className="font-bold text-2xl tracking-tight">Debug</h1>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Environment Info</h2>
        <InfoRow label="Environment" value={import.meta.env.MODE} />
        <InfoRow
          label="Screen"
          value={`${screenSize.width} x ${screenSize.height}`}
        />
        <InfoRow
          label="User Agent"
          value={navigator.userAgent}
          valueClassName="text-xs break-all"
        />
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Device Info</h2>
        <InfoRow label="Platform" value={detectPlatform()} />
        <InfoRow label="Pixel Ratio" value={`${window.devicePixelRatio}x`} />
        <InfoRow label="Online" value={navigator.onLine ? 'Yes' : 'No'} />
        <InfoRow label="Language" value={navigator.language} />
        <InfoRow
          label="Touch Support"
          value={'ontouchstart' in window ? 'Yes' : 'No'}
        />
        <InfoRow
          label="Standalone"
          value={
            window.matchMedia('(display-mode: standalone)').matches
              ? 'Yes'
              : 'No'
          }
        />
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">API Status</h2>
        <div className="flex justify-between gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">API URL</span>
          <span className="min-w-0 break-all text-right text-xs">
            {API_BASE_URL || '(not set)'}
          </span>
        </div>
        {pingLoading && (
          <p className="text-muted-foreground text-sm">Loading...</p>
        )}
        {pingError && <p className="text-destructive text-sm">{pingError}</p>}
        {!pingLoading && !pingError && ping && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Version</span>
              <span className="font-medium text-green-600">{ping.version}</span>
            </div>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full"
          onClick={fetchPing}
          disabled={pingLoading}
        >
          <RefreshCw className="mr-2 h-3 w-3" />
          {pingLoading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
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
  );
}
