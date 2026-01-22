import { Button } from '@/components/ui/button';
import { useScreensaver } from './ScreensaverContext';

export function ScreensaverButton() {
  const { activate } = useScreensaver();

  const isMac =
    typeof navigator !== 'undefined' &&
    navigator.platform.toUpperCase().includes('MAC');
  const shortcut = isMac ? 'Cmd+L' : 'Ctrl+L';

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">Screensaver</p>
        <p className="text-muted-foreground text-sm">
          Press {shortcut} or click to start the laser screensaver
        </p>
      </div>
      <Button
        variant="outline"
        onClick={activate}
        size="sm"
        data-testid="screensaver-start-button"
      >
        Start Screensaver
      </Button>
    </div>
  );
}
