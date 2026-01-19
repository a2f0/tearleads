import { BottomSheet } from '@/components/ui/bottom-sheet';
import { FontSelector } from './FontSelector';
import { PatternSelector } from './PatternSelector';
import { ThemeSelector } from './ThemeSelector';

interface DisplayPropertiesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DisplayPropertiesSheet({
  open,
  onOpenChange
}: DisplayPropertiesSheetProps) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Display Properties"
      data-testid="display-properties-sheet"
      fitContent
      maxHeightPercent={1}
    >
      <div className="space-y-6">
        <ThemeSelector />
        <PatternSelector />
        <FontSelector />
      </div>
    </BottomSheet>
  );
}
