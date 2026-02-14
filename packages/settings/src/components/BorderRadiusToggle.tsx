import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsProvider.js';
import type { BorderRadiusValue } from '../types/user-settings.js';
import { Button } from './ui/button.js';

export function BorderRadiusToggle() {
  const { t } = useTranslation('settings');
  const { getSetting, setSetting } = useSettings();
  const borderRadius = getSetting('borderRadius');

  const handleSelect = useCallback(
    (value: BorderRadiusValue) => {
      setSetting('borderRadius', value);
    },
    [setSetting]
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{t('borderRadius')}</p>
        <p className="text-muted-foreground text-sm">
          {t('borderRadiusDescription')}
        </p>
      </div>
      <div className="flex gap-2" data-testid="border-radius-toggle-container">
        <Button
          variant={borderRadius === 'rounded' ? 'default' : 'outline'}
          onClick={() => handleSelect('rounded')}
          data-testid="border-radius-rounded-button"
          size="sm"
        >
          {t('borderRadiusRounded')}
        </Button>
        <Button
          variant={borderRadius === 'square' ? 'default' : 'outline'}
          onClick={() => handleSelect('square')}
          data-testid="border-radius-square-button"
          size="sm"
        >
          {t('borderRadiusSquare')}
        </Button>
      </div>
    </div>
  );
}
