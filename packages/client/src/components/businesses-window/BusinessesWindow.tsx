import { BusinessesWindow as BaseBusinessesWindow } from '@tearleads/businesses';
import type { WindowDimensions } from '@tearleads/window-manager';
import { BusinessesManager } from '@/components/businesses';
import { ClientBusinessesProvider } from '@/contexts/ClientBusinessesProvider';

interface BusinessesWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function BusinessesWindow(props: BusinessesWindowProps) {
  return (
    <ClientBusinessesProvider>
      <BaseBusinessesWindow {...props}>
        <BusinessesManager />
      </BaseBusinessesWindow>
    </ClientBusinessesProvider>
  );
}
