import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/db/SettingsProvider';
import type { WindowOpacityValue } from '@/db/user-settings';

export function WindowOpacityToggle() {
  const { t } = useTranslation('settings');
  const { getSetting, setSetting } = useSettings();
  const translucent = getSetting('windowOpacity') === 'translucent';

  const handleToggle = useCallback(
    (value: WindowOpacityValue) => {
      setSetting('windowOpacity', value);
    },
    [setSetting]
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{t('windowOpacity')}</p>
        <p className="text-muted-foreground text-sm">
          {t('windowOpacityDescription')}
        </p>
      </div>
      <div className="flex gap-2" data-testid="window-opacity-toggle-container">
        <Button
          variant={translucent ? 'default' : 'outline'}
          onClick={() => handleToggle('translucent')}
          data-testid="window-opacity-translucent-button"
          size="sm"
        >
          {t('windowOpacityTranslucent')}
        </Button>
        <Button
          variant={!translucent ? 'default' : 'outline'}
          onClick={() => handleToggle('opaque')}
          data-testid="window-opacity-opaque-button"
          size="sm"
        >
          {t('windowOpacityOpaque')}
        </Button>
      </div>
    </div>
  );
}
