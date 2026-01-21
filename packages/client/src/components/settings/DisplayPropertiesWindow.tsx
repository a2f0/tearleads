import { FloatingWindow } from '@/components/floating-window';
import { DisplayPropertiesWindowMenuBar } from './DisplayPropertiesWindowMenuBar';
import { FontSelector } from './FontSelector';
import { IconDepthToggle } from './IconDepthToggle';
import { PatternSelector } from './PatternSelector';
import { ThemeSelector } from './ThemeSelector';

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
      defaultWidth={440}
      defaultHeight={420}
      minWidth={360}
      minHeight={320}
      maxWidthPercent={0.9}
      maxHeightPercent={0.9}
      zIndex={1000}
    >
      <div className="flex h-full flex-col">
        <DisplayPropertiesWindowMenuBar onClose={() => onOpenChange(false)} />
        <div className="space-y-6 p-5">
          <ThemeSelector />
          <PatternSelector />
          <IconDepthToggle />
          <FontSelector />
        </div>
      </div>
    </FloatingWindow>
  );
}
