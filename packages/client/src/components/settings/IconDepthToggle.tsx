import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/db/SettingsProvider';
import type { DesktopIconDepthValue } from '@/db/user-settings';

export function IconDepthToggle() {
  const { t } = useTranslation('settings');
  const { getSetting, setSetting } = useSettings();
  const embossed = getSetting('desktopIconDepth') === 'embossed';

  const handleToggle = useCallback(
    (value: DesktopIconDepthValue) => {
      setSetting('desktopIconDepth', value);
    },
    [setSetting]
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{t('iconDepth')}</p>
        <p className="text-muted-foreground text-sm">
          {t('iconDepthDescription')}
        </p>
      </div>
      <div className="flex gap-2" data-testid="icon-depth-toggle-container">
        <Button
          variant={embossed ? 'default' : 'outline'}
          onClick={() => handleToggle('embossed')}
          data-testid="icon-depth-embossed-button"
          size="sm"
        >
          {t('iconDepthEmbossed')}
        </Button>
        <Button
          variant={!embossed ? 'default' : 'outline'}
          onClick={() => handleToggle('debossed')}
          data-testid="icon-depth-debossed-button"
          size="sm"
        >
          {t('iconDepthDebossed')}
        </Button>
      </div>
    </div>
  );
}
