import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { useTypedTranslation } from '@/i18n';
import { MlsChatPage } from '@/pages/MlsChat';

interface MlsChatWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function MlsChatWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: MlsChatWindowProps) {
  const { t } = useTypedTranslation('menu');

  return (
    <FloatingWindow
      id={id}
      title={t('mlsChat')}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions !== undefined && { initialDimensions })}
      defaultWidth={600}
      defaultHeight={500}
      minWidth={400}
      minHeight={350}
    >
      <div className="flex h-full flex-col overflow-hidden">
        <MlsChatPage className="h-full" />
      </div>
    </FloatingWindow>
  );
}
