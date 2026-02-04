import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useDatabaseContext } from '@/db/hooks';
import { useTypedTranslation } from '@/i18n';
import { MlsChatPage } from '@/pages/MlsChat';
import { MlsChatWindowMenuBar } from './MlsChatWindowMenuBar';

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
  const { isUnlocked, isLoading: isDatabaseLoading } = useDatabaseContext();

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
        {isDatabaseLoading && (
          <div className="flex flex-1 items-center justify-center rounded-lg border p-8 text-center text-muted-foreground">
            Loading database...
          </div>
        )}

        {!isDatabaseLoading && !isUnlocked && (
          <div className="flex flex-1 items-center justify-center p-4">
            <InlineUnlock description="MLS chat" />
          </div>
        )}

        {isUnlocked && (
          <>
            <MlsChatWindowMenuBar onClose={onClose} />
            <div className="flex-1 overflow-hidden">
              <MlsChatPage className="h-full" />
            </div>
          </>
        )}
      </div>
    </FloatingWindow>
  );
}
