import {
  BorderRadiusToggle,
  FontSelector,
  IconBackgroundToggle,
  IconDepthToggle,
  PatternSelector,
  ThemeSelector
} from '@tearleads/app-settings';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar
} from '@tearleads/window-manager';
import { ScreensaverButton } from '@/components/screensaver';
import { DisplayPropertiesWindowMenuBar } from './DisplayPropertiesWindowMenuBar';

interface DisplayPropertiesWindowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DisplayPropertiesWindow({
  open,
  onOpenChange
}: DisplayPropertiesWindowProps) {
  if (!open) return null;

  return (
    <FloatingWindow
      id="display-properties"
      title="Display Properties"
      onClose={() => onOpenChange(false)}
      fitContent
      defaultWidth={680}
      defaultHeight={460}
      minWidth={500}
      minHeight={360}
      maxWidthPercent={0.9}
      maxHeightPercent={0.9}
      zIndex={1000}
    >
      <div className="flex h-full flex-col">
        <DisplayPropertiesWindowMenuBar onClose={() => onOpenChange(false)} />
        <WindowControlBar>{null}</WindowControlBar>
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <ThemeSelector />
          <PatternSelector />
          <IconDepthToggle />
          <IconBackgroundToggle />
          <FontSelector />
          <BorderRadiusToggle />
          <ScreensaverButton />
        </div>
      </div>
    </FloatingWindow>
  );
}
