import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  type WindowDimensions
} from '@tearleads/window-manager';
import { Settings } from '@/pages/Settings';
import { SettingsWindowMenuBar } from './SettingsWindowMenuBar';

interface SettingsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function SettingsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: SettingsWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Settings"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      fitContent
      defaultWidth={960}
      defaultHeight={640}
      minWidth={840}
      minHeight={520}
      maxWidthPercent={1}
      maxHeightPercent={1}
    >
      <div className="flex h-full flex-col">
        <SettingsWindowMenuBar onClose={onClose} />
        <WindowControlBar>{null}</WindowControlBar>
        <div className="flex-1 overflow-auto p-3">
          <Settings showBackLink={false} />
        </div>
      </div>
    </FloatingWindow>
  );
}
