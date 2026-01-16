import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/db/SettingsProvider';
import type { TooltipsValue } from '@/db/user-settings';

export function TooltipsToggle() {
  const { t } = useTranslation('settings');
  const { getSetting, setSetting } = useSettings();
  const tooltipsEnabled = getSetting('tooltips') === 'enabled';

  const handleToggle = useCallback(
    (value: TooltipsValue) => {
      setSetting('tooltips', value);
    },
    [setSetting]
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{t('tooltips')}</p>
        <p className="text-muted-foreground text-sm">
          {t('tooltipsDescription')}
        </p>
      </div>
      <div className="flex gap-2" data-testid="tooltips-toggle-container">
        <Button
          variant={tooltipsEnabled ? 'default' : 'outline'}
          onClick={() => handleToggle('enabled')}
          data-testid="tooltips-enabled-button"
          size="sm"
        >
          {t('tooltipsEnabled')}
        </Button>
        <Button
          variant={!tooltipsEnabled ? 'default' : 'outline'}
          onClick={() => handleToggle('disabled')}
          data-testid="tooltips-disabled-button"
          size="sm"
        >
          {t('tooltipsDisabled')}
        </Button>
      </div>
    </div>
  );
}
