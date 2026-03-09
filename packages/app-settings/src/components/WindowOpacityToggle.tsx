import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsProvider.js';
import { Button } from './ui/button.js';

export function WindowOpacityToggle() {
  const { t } = useTranslation('settings');
  const { getSetting, setSetting } = useSettings();
  const translucent = getSetting('windowOpacity') === 'translucent';

  const handleSetTranslucent = useCallback(() => {
    setSetting('windowOpacity', 'translucent');
  }, [setSetting]);

  const handleSetOpaque = useCallback(() => {
    setSetting('windowOpacity', 'opaque');
  }, [setSetting]);

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
          onClick={handleSetTranslucent}
          data-testid="window-opacity-translucent-button"
          size="sm"
        >
          {t('windowOpacityTranslucent')}
        </Button>
        <Button
          variant={!translucent ? 'default' : 'outline'}
          onClick={handleSetOpaque}
          data-testid="window-opacity-opaque-button"
          size="sm"
        >
          {t('windowOpacityOpaque')}
        </Button>
      </div>
    </div>
  );
}
