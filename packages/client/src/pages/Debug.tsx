import { formatDate, type HealthData } from '@rapid/shared';
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
    <div className="text-sm">
      <span className="font-medium">{label}: </span>
      <span className={cn('text-muted-foreground', valueClassName)}>
        {value}
      </span>
    </div>
  );
}

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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Debug</h1>

      <div className="rounded-lg border p-4 space-y-3">
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

      <div className="rounded-lg border p-4 space-y-3">
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
                className={cn(
                  'font-medium',
                  health.status === 'healthy'
                    ? 'text-green-600'
                    : 'text-red-600'
                )}
              >
                {health.status.charAt(0).toUpperCase() + health.status.slice(1)}
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
  );
}
