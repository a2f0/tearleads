import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsProvider.js';
import type { DesktopIconBackgroundValue } from '../types/user-settings.js';
import { Button } from './ui/button.js';

export function IconBackgroundToggle() {
  const { t } = useTranslation('settings');
  const { getSetting, setSetting } = useSettings();
  const colored = getSetting('desktopIconBackground') === 'colored';

  const handleToggle = useCallback(
    (value: DesktopIconBackgroundValue) => {
      setSetting('desktopIconBackground', value);
    },
    [setSetting]
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{t('iconBackground')}</p>
        <p className="text-muted-foreground text-sm">
          {t('iconBackgroundDescription')}
        </p>
      </div>
      <div
        className="flex gap-2"
        data-testid="icon-background-toggle-container"
      >
        <Button
          variant={colored ? 'default' : 'outline'}
          onClick={() => handleToggle('colored')}
          data-testid="icon-background-colored-button"
          size="sm"
        >
          {t('iconBackgroundColored')}
        </Button>
        <Button
          variant={!colored ? 'default' : 'outline'}
          onClick={() => handleToggle('transparent')}
          data-testid="icon-background-transparent-button"
          size="sm"
        >
          {t('iconBackgroundTransparent')}
        </Button>
      </div>
    </div>
  );
}
