import type { PingData } from '@tearleads/shared';
import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { useAppVersion } from '@/hooks/useAppVersion';
import { API_BASE_URL, api } from '@/lib/api';
import { detectPlatform } from '@/lib/utils';
import { InfoRow } from './InfoRow';

interface DebugProps {
  showTitle?: boolean;
  showBackLink?: boolean;
  backTo?: string;
  backLabel?: string;
}

export function Debug({
  showTitle = true,
  showBackLink = false,
  backTo = '/',
  backLabel
}: DebugProps) {
  const { t } = useTranslation('debug');
  const { t: tCommon } = useTranslation('common');
  const appVersion = useAppVersion();
  const resolvedBackLabel = backLabel ?? t('backToHome');
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
      setPingError(t('failedToConnectToApi'));
    } finally {
      setPingLoading(false);
    }
  }, [t]);

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
      { label: t('version'), value: appVersion ?? t('unknown') },
      { label: t('environment'), value: import.meta.env.MODE },
      {
        label: t('screen'),
        value: `${screenSize.width} x ${screenSize.height}`
      },
      {
        label: t('userAgent'),
        value: navigator.userAgent,
        valueClassName: 'text-xs break-all'
      },
      { label: t('platform'), value: detectPlatform() },
      { label: t('pixelRatio'), value: `${window.devicePixelRatio}x` },
      { label: t('online'), value: navigator.onLine ? t('yes') : t('no') },
      { label: t('language'), value: navigator.language },
      {
        label: t('touchSupport'),
        value: 'ontouchstart' in window ? t('yes') : t('no')
      },
      {
        label: t('standalone'),
        value: window.matchMedia('(display-mode: standalone)').matches
          ? t('yes')
          : t('no')
      }
    ],
    [appVersion, screenSize, t]
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
      {(showBackLink || showTitle) && (
        <div className="space-y-2">
          {showBackLink && (
            <BackLink defaultTo={backTo} defaultLabel={resolvedBackLabel} />
          )}
          {showTitle && (
            <h1 className="font-bold text-2xl tracking-tight">{t('debug')}</h1>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>{t('systemInfo')}</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={copyDebugInfo}
            aria-label={t('copyDebugInfoToClipboard')}
            data-testid="copy-debug-info"
          >
            {isCopied ? (
              <Check className="h-4 w-4 text-success" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('apiStatus')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">
              {t('apiUrl')}
            </span>
            <span className="min-w-0 break-all text-right text-xs">
              {API_BASE_URL || t('notSet')}
            </span>
          </div>
          {pingLoading && (
            <p className="text-muted-foreground text-sm">
              {tCommon('loading')}
            </p>
          )}
          {pingError && <p className="text-destructive text-sm">{pingError}</p>}
          {!pingLoading && !pingError && ping && (
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('version')}</span>
                <span className="font-medium text-success">{ping.version}</span>
              </div>
            </div>
          )}
          <RefreshButton
            onClick={fetchPing}
            loading={pingLoading}
            className="w-full"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('actions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => setShouldThrow(true)}
            data-testid="throw-error-button"
          >
            {t('throwError')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
