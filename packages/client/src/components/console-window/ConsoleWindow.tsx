import { useCallback } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Terminal } from '@/pages/console/components/Terminal';
import { ConsoleWindowMenuBar } from './ConsoleWindowMenuBar';

interface ConsoleWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function ConsoleWindow({
  id,
  onClose,
  onMinimize,
  onFocus,
  zIndex,
  initialDimensions
}: ConsoleWindowProps) {
  const handleNewTab = useCallback(() => {
    // TODO: Implement tab support
  }, []);

  const handleSplitHorizontal = useCallback(() => {
    // TODO: Implement horizontal split
  }, []);

  const handleSplitVertical = useCallback(() => {
    // TODO: Implement vertical split
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="Console"
      onClose={onClose}
      onMinimize={onMinimize}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={500}
      minWidth={400}
      minHeight={300}
    >
      <div className="flex h-full flex-col">
        <ConsoleWindowMenuBar
          onNewTab={handleNewTab}
          onClose={onClose}
          onSplitHorizontal={handleSplitHorizontal}
          onSplitVertical={handleSplitVertical}
        />
        <div className="flex-1 overflow-hidden">
          <Terminal className="h-full rounded-none border-0" />
        </div>
      </div>
    </FloatingWindow>
  );
}
