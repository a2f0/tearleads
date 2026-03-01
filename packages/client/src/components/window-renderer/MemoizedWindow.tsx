import type { WindowDimensions } from '@tearleads/window-manager';
import { memo, useCallback } from 'react';
import type { MemoizedWindowProps } from './windowRendererTypes';

const defaultInitialDimensions = (window: MemoizedWindowProps['window']) =>
  window.dimensions;

export const MemoizedWindow = memo(function MemoizedWindow({
  window,
  config,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus
}: MemoizedWindowProps) {
  const WindowComponent = config.Component;
  const resolvedInitialDimensions =
    config.getInitialDimensions?.(window) ?? defaultInitialDimensions(window);

  const handleClose = useCallback(
    () => onClose(window.id),
    [onClose, window.id]
  );
  const handleMinimize = useCallback(
    (dimensions: WindowDimensions) => onMinimize(window.id, dimensions),
    [onMinimize, window.id]
  );
  const handleDimensionsChange = useCallback(
    (dimensions: WindowDimensions) =>
      onDimensionsChange(window.type, window.id, dimensions),
    [onDimensionsChange, window.type, window.id]
  );
  const handleRename = useCallback(
    (title: string) => onRename(window.id, title),
    [onRename, window.id]
  );
  const handleFocus = useCallback(
    () => onFocus(window.id),
    [onFocus, window.id]
  );

  return (
    <WindowComponent
      id={window.id}
      onClose={handleClose}
      onMinimize={handleMinimize}
      onDimensionsChange={handleDimensionsChange}
      onRename={handleRename}
      onFocus={handleFocus}
      zIndex={window.zIndex}
      {...(resolvedInitialDimensions && {
        initialDimensions: resolvedInitialDimensions
      })}
    />
  );
});
