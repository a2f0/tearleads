import type { WindowTitleBarProps } from './WindowTitleBar.js';
import { WindowTitleBar } from './WindowTitleBar.js';

interface FloatingWindowBodyProps {
  titleBarProps: WindowTitleBarProps;
  contentRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}

export function FloatingWindowBody({
  titleBarProps,
  contentRef,
  children
}: FloatingWindowBodyProps) {
  return (
    <>
      <WindowTitleBar {...titleBarProps} />
      <div ref={contentRef} className="flex-1 overflow-auto">
        {children}
      </div>
    </>
  );
}
