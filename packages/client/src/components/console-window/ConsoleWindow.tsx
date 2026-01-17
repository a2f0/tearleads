import { X } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { cn } from '@/lib/utils';
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

interface TerminalTab {
  id: string;
  name: string;
}

type SplitDirection = 'none' | 'horizontal' | 'vertical';

let tabIdCounter = 0;
function generateTabId(): string {
  tabIdCounter += 1;
  return `tab-${tabIdCounter}`;
}

export function ConsoleWindow({
  id,
  onClose,
  onMinimize,
  onFocus,
  zIndex,
  initialDimensions
}: ConsoleWindowProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => {
    const initialTab = { id: generateTabId(), name: 'Terminal 1' };
    return [initialTab];
  });
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '');
  const [splitDirection, setSplitDirection] = useState<SplitDirection>('none');
  const [splitTabId, setSplitTabId] = useState<string | null>(null);

  const handleNewTab = useCallback(() => {
    const newTab: TerminalTab = {
      id: generateTabId(),
      name: `Terminal ${tabs.length + 1}`
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs.length]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (tabs.length === 1) {
        onClose();
        return;
      }

      const tabIndex = tabs.findIndex((t) => t.id === tabId);
      setTabs((prev) => prev.filter((t) => t.id !== tabId));

      // If we're closing the split pane, remove split
      if (splitTabId === tabId) {
        setSplitDirection('none');
        setSplitTabId(null);
      }

      // If closing the active tab, switch to another tab
      if (activeTabId === tabId) {
        const newIndex = tabIndex === 0 ? 0 : tabIndex - 1;
        const remainingTabs = tabs.filter((t) => t.id !== tabId);
        if (remainingTabs[newIndex]) {
          setActiveTabId(remainingTabs[newIndex].id);
        }
      }
    },
    [tabs, activeTabId, splitTabId, onClose]
  );

  const handleSplitHorizontal = useCallback(() => {
    if (splitDirection !== 'none') {
      // Already split, close the split
      if (splitTabId) {
        setTabs((prev) => prev.filter((t) => t.id !== splitTabId));
      }
      setSplitDirection('none');
      setSplitTabId(null);
      return;
    }
    const newTab: TerminalTab = {
      id: generateTabId(),
      name: `Terminal ${tabs.length + 1}`
    };
    setTabs((prev) => [...prev, newTab]);
    setSplitDirection('horizontal');
    setSplitTabId(newTab.id);
  }, [splitDirection, splitTabId, tabs.length]);

  const handleSplitVertical = useCallback(() => {
    if (splitDirection !== 'none') {
      // Already split, close the split
      if (splitTabId) {
        setTabs((prev) => prev.filter((t) => t.id !== splitTabId));
      }
      setSplitDirection('none');
      setSplitTabId(null);
      return;
    }
    const newTab: TerminalTab = {
      id: generateTabId(),
      name: `Terminal ${tabs.length + 1}`
    };
    setTabs((prev) => [...prev, newTab]);
    setSplitDirection('vertical');
    setSplitTabId(newTab.id);
  }, [splitDirection, splitTabId, tabs.length]);

  // Get visible tabs (exclude split pane tab from tab bar)
  const visibleTabs = tabs.filter((t) => t.id !== splitTabId);

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
        {/* Tab bar */}
        {visibleTabs.length > 1 && (
          <div className="flex shrink-0 gap-0.5 border-b bg-muted/30 px-1 py-0.5">
            {visibleTabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  'group flex items-center gap-1 rounded-t px-2 py-0.5 text-xs',
                  activeTabId === tab.id
                    ? 'bg-background'
                    : 'hover:bg-background/50'
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveTabId(tab.id)}
                  className="max-w-24 truncate"
                >
                  {tab.name}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                  className="rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
                  aria-label={`Close ${tab.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Terminal content area */}
        <div
          className={cn(
            'flex flex-1 overflow-hidden',
            splitDirection === 'horizontal' && 'flex-col',
            splitDirection === 'vertical' && 'flex-row'
          )}
        >
          {/* Main terminal pane */}
          <div
            className={cn(
              'overflow-hidden',
              splitDirection === 'none' && 'flex-1',
              splitDirection !== 'none' && 'flex-1'
            )}
          >
            {visibleTabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  'h-full',
                  tab.id === activeTabId ? 'block' : 'hidden'
                )}
              >
                <Terminal className="h-full rounded-none border-0" />
              </div>
            ))}
          </div>
          {/* Split pane */}
          {splitDirection !== 'none' && splitTabId && (
            <>
              <div
                className={cn(
                  'shrink-0 bg-border',
                  splitDirection === 'horizontal' && 'h-px',
                  splitDirection === 'vertical' && 'w-px'
                )}
              />
              <div className="flex-1 overflow-hidden">
                <Terminal className="h-full rounded-none border-0" />
              </div>
            </>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
