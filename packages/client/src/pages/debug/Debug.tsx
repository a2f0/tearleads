import type { PingData } from '@rapid/shared';
import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { useAppVersion } from '@/hooks/useAppVersion';
import { API_BASE_URL, api } from '@/lib/api';
import { detectPlatform } from '@/lib/utils';
import { InfoRow } from './InfoRow';

interface DebugProps {
  showTitle?: boolean;
}

export function Debug({ showTitle = true }: DebugProps) {
  const appVersion = useAppVersion();
  const [ping, setPing] = useState<PingData | null>(null);
  const [pingLoading, setPingLoading] = useState(false);
  const [pingError, setPingError] = useState<string | null>(null);
  const [shouldThrow, setShouldThrow] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
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

  const systemInfo = useMemo(
    () => [
      { label: 'Version', value: appVersion ?? 'Unknown' },
      { label: 'Environment', value: import.meta.env.MODE },
      { label: 'Screen', value: `${screenSize.width} x ${screenSize.height}` },
      {
        label: 'User Agent',
        value: navigator.userAgent,
        valueClassName: 'text-xs break-all'
      },
      { label: 'Platform', value: detectPlatform() },
      { label: 'Pixel Ratio', value: `${window.devicePixelRatio}x` },
      { label: 'Online', value: navigator.onLine ? 'Yes' : 'No' },
      { label: 'Language', value: navigator.language },
      {
        label: 'Touch Support',
        value: 'ontouchstart' in window ? 'Yes' : 'No'
      },
      {
        label: 'Standalone',
        value: window.matchMedia('(display-mode: standalone)').matches
          ? 'Yes'
          : 'No'
      }
    ],
    [appVersion, screenSize]
  );

  const copyDebugInfo = useCallback(() => {
    const info = systemInfo
      .map((item) => `${item.label}: ${item.value}`)
      .join('\n');
    navigator.clipboard
      .writeText(info)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      })
      .catch((err) => {
        console.error('Failed to copy debug info:', err);
      });
  }, [systemInfo]);

  return (
    <div className="space-y-6 overflow-x-hidden">
      {showTitle && (
        <h1 className="font-bold text-2xl tracking-tight">Debug</h1>
      )}

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">System Info</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={copyDebugInfo}
            aria-label="Copy debug info to clipboard"
            data-testid="copy-debug-info"
          >
            {isCopied ? (
              <Check className="h-4 w-4 text-success" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
        {systemInfo.map((item) => (
          <InfoRow
            key={item.label}
            label={item.label}
            value={item.value}
            {...(item.valueClassName && {
              valueClassName: item.valueClassName
            })}
          />
        ))}
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
              <span className="font-medium text-success">{ping.version}</span>
            </div>
          </div>
        )}
        <RefreshButton
          onClick={fetchPing}
          loading={pingLoading}
          className="mt-2 w-full"
        />
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Actions</h2>
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
