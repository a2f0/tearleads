import type { WindowTitleBarProps } from './WindowTitleBar.js';
import { WindowTitleBar } from './WindowTitleBar.js';

interface FloatingWindowBodyProps {
  titleBarProps: WindowTitleBarProps;
  contentRef: React.RefObject<HTMLDivElement | null>;
  contentClassName?: string;
  children: React.ReactNode;
}

export function FloatingWindowBody({
  titleBarProps,
  contentRef,
  contentClassName,
  children
}: FloatingWindowBodyProps) {
  return (
    <>
      <WindowTitleBar {...titleBarProps} />
      <div ref={contentRef} className={`flex-1 overflow-auto ${contentClassName ?? ''}`.trim()}>
        {children}
      </div>
    </>
  );
}
