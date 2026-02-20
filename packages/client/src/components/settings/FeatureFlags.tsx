import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useFeatureFlags } from '@/hooks/app';

function formatFlagValue(value: boolean): string {
  return value ? 'On' : 'Off';
}

export function FeatureFlags() {
  const { entries, hasOverrides, setOverride, clearOverride, resetOverrides } =
    useFeatureFlags();

  const handleResetAll = useCallback(() => {
    resetOverrides();
  }, [resetOverrides]);

  return (
    <div className="space-y-4" data-testid="feature-flags-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">Feature Flags</p>
          <p className="text-muted-foreground text-sm">
            Override experimental behavior stored on this device.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasOverrides}
          onClick={handleResetAll}
          data-testid="feature-flags-reset-all"
        >
          Reset all
        </Button>
      </div>

      <div className="space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.key}
            className="rounded-lg border p-3"
            data-testid={`feature-flag-${entry.key}`}
          >
            <div className="space-y-2">
              <div>
                <p className="font-medium">{entry.label}</p>
                <p className="text-muted-foreground text-sm">
                  {entry.description}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={entry.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setOverride(entry.key, true)}
                  data-testid={`feature-flag-${entry.key}-on`}
                >
                  On
                </Button>
                <Button
                  variant={!entry.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setOverride(entry.key, false)}
                  data-testid={`feature-flag-${entry.key}-off`}
                >
                  Off
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!entry.isOverridden}
                  onClick={() => clearOverride(entry.key)}
                  data-testid={`feature-flag-${entry.key}-reset`}
                >
                  Reset
                </Button>
                <span
                  className="text-muted-foreground text-xs"
                  data-testid={`feature-flag-${entry.key}-status`}
                >
                  Status: {formatFlagValue(entry.value)} · Default:{' '}
                  {formatFlagValue(entry.defaultValue)}{' '}
                  {entry.isOverridden ? '(overridden)' : '(default)'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
