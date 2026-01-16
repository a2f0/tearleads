import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/db/SettingsProvider';
import type { FontValue } from '@/db/user-settings';

export function FontSelector() {
  const { t } = useTranslation('settings');
  const { getSetting, setSetting } = useSettings();
  const font = getSetting('font');

  const handleSelect = useCallback(
    (value: FontValue) => {
      setSetting('font', value);
    },
    [setSetting]
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{t('font')}</p>
        <p className="text-muted-foreground text-sm">{t('fontDescription')}</p>
      </div>
      <div className="flex gap-2" data-testid="font-selector-container">
        <Button
          variant={font === 'system' ? 'default' : 'outline'}
          onClick={() => handleSelect('system')}
          data-testid="font-system-button"
          size="sm"
        >
          {t('fontSystem')}
        </Button>
        <Button
          variant={font === 'monospace' ? 'default' : 'outline'}
          onClick={() => handleSelect('monospace')}
          data-testid="font-monospace-button"
          size="sm"
        >
          {t('fontMonospace')}
        </Button>
      </div>
    </div>
  );
}
