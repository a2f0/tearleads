import { FloatingWindow } from '@/components/floating-window';
import { FontSelector } from './FontSelector';
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
      zIndex={60}
    >
      <div className="space-y-6 p-5">
        <ThemeSelector />
        <PatternSelector />
        <FontSelector />
      </div>
    </FloatingWindow>
  );
}
