import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  type WindowDimensions
} from '@tearleads/window-manager';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Sync } from '../../pages/sync';
import { SyncWindowMenuBar } from './SyncWindowMenuBar';

interface SyncWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function SyncWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: SyncWindowProps) {
  const { t } = useTranslation('sync');
  const controlItems: ReactNode[] = [];
  const hasControlItems = controlItems.length > 0;

  return (
    <FloatingWindow
      id={id}
      title={t('sync')}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      fitContent
      defaultWidth={400}
      defaultHeight={450}
      minWidth={350}
      minHeight={350}
      maxWidthPercent={1}
      maxHeightPercent={1}
    >
      <div className="flex h-full min-h-0 flex-col">
        <SyncWindowMenuBar onClose={onClose} />
        {hasControlItems ? (
          <WindowControlBar>{controlItems}</WindowControlBar>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <Sync showBackLink={false} />
        </div>
      </div>
    </FloatingWindow>
  );
}
