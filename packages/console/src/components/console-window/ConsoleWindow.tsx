import { cn } from '@tearleads/ui';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions
} from '@tearleads/window-manager';
import { ArrowLeft, Columns2, Plus, Rows2, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { ConsoleTerminal } from '../console-terminal';
import { ConsoleDocumentation } from './ConsoleDocumentation';
import { ConsoleWindowMenuBar } from './ConsoleWindowMenuBar';

interface ConsoleWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

interface TerminalTab {
  id: string;
  name: string;
}

type SplitDirection = 'none' | 'horizontal' | 'vertical';

function generateTabId(): string {
  return crypto.randomUUID();
}

export function ConsoleWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: ConsoleWindowProps) {
  const [showDocumentation, setShowDocumentation] = useState(false);
  const [tabs, setTabs] = useState<TerminalTab[]>(() => {
    const initialTab = { id: generateTabId(), name: 'Terminal 1' };
    return [initialTab];
  });
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '');
  const [splitDirection, setSplitDirection] = useState<SplitDirection>('none');
  const [splitTabId, setSplitTabId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<'main' | 'split'>('main');

  const handleNewTab = useCallback(() => {
    const newTab: TerminalTab = {
      id: generateTabId(),
      name: `Terminal ${tabs.length + 1}`
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setFocusTarget('main');
  }, [tabs.length]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (tabs.length === 1) {
        onClose();
        return;
      }

      const tabIndex = tabs.findIndex((t) => t.id === tabId);
      const newTabs = tabs.filter((t) => t.id !== tabId);
      setTabs(newTabs);

      // If we're closing the split pane, remove split
      if (splitTabId === tabId) {
        setSplitDirection('none');
        setSplitTabId(null);
        setFocusTarget('main');
      }

      // If closing the active tab, switch to another tab
      if (activeTabId === tabId) {
        const newIndex = tabIndex === 0 ? 0 : tabIndex - 1;
        if (newTabs[newIndex]) {
          setActiveTabId(newTabs[newIndex].id);
          setFocusTarget('main');
        }
      }
    },
    [tabs, activeTabId, splitTabId, onClose]
  );

  const handleSplit = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      if (splitDirection !== 'none') {
        // Already split, close the split
        if (splitTabId) {
          setTabs((prev) => prev.filter((t) => t.id !== splitTabId));
        }
        setSplitDirection('none');
        setSplitTabId(null);
        setFocusTarget('main');
        return;
      }
      const newTab: TerminalTab = {
        id: generateTabId(),
        name: `Terminal ${tabs.length + 1}`
      };
      setTabs((prev) => [...prev, newTab]);
      setSplitDirection(direction);
      setSplitTabId(newTab.id);
      setFocusTarget('split');
    },
    [splitDirection, splitTabId, tabs.length]
  );

  const handleSplitHorizontal = useCallback(
    () => handleSplit('horizontal'),
    [handleSplit]
  );

  const handleSplitVertical = useCallback(
    () => handleSplit('vertical'),
    [handleSplit]
  );

  // Get visible tabs (exclude split pane tab from tab bar)
  const visibleTabs = tabs.filter((t) => t.id !== splitTabId);

  return (
    <FloatingWindow
      id={id}
      title="Console"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
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
          onOpenDocumentation={() => setShowDocumentation(true)}
        />
        <WindowControlBar>
          <WindowControlGroup>
            {showDocumentation ? (
              <WindowControlButton
                icon={<ArrowLeft className="h-3 w-3" />}
                onClick={() => setShowDocumentation(false)}
                data-testid="console-window-control-back"
              >
                Back
              </WindowControlButton>
            ) : (
              <>
                <WindowControlButton
                  icon={<Plus className="h-3 w-3" />}
                  onClick={handleNewTab}
                  data-testid="console-window-control-new-tab"
                >
                  New Tab
                </WindowControlButton>
                <WindowControlButton
                  icon={<Rows2 className="h-3 w-3" />}
                  onClick={handleSplitHorizontal}
                  data-testid="console-window-control-split-horizontal"
                >
                  Split H
                </WindowControlButton>
                <WindowControlButton
                  icon={<Columns2 className="h-3 w-3" />}
                  onClick={handleSplitVertical}
                  data-testid="console-window-control-split-vertical"
                >
                  Split V
                </WindowControlButton>
              </>
            )}
          </WindowControlGroup>
        </WindowControlBar>
        {showDocumentation ? (
          <div className="flex-1 overflow-auto p-4">
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setShowDocumentation(false)}
                className="inline-flex items-center text-muted-foreground text-sm hover:text-foreground"
              >
                Back to Console
              </button>
              <ConsoleDocumentation />
            </div>
          </div>
        ) : (
          <>
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
                      onClick={() => {
                        setActiveTabId(tab.id);
                        setFocusTarget('main');
                      }}
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
                'flex min-h-0 min-w-0 flex-1 overflow-hidden',
                splitDirection === 'horizontal' && 'flex-col',
                splitDirection === 'vertical' && 'flex-row'
              )}
            >
              {/* Main terminal pane */}
              <div
                className="min-h-0 min-w-0 flex-1 overflow-hidden"
                data-testid="console-main-pane"
              >
                {visibleTabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={cn(
                      'h-full',
                      tab.id === activeTabId ? 'block' : 'hidden'
                    )}
                  >
                    <ConsoleTerminal
                      className="h-full rounded-none border-0"
                      autoFocus={
                        focusTarget === 'main' && tab.id === activeTabId
                      }
                    />
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
                  <div
                    className="min-h-0 min-w-0 flex-1 overflow-hidden"
                    data-testid="console-split-pane"
                  >
                    <ConsoleTerminal
                      className="h-full rounded-none border-0"
                      autoFocus={focusTarget === 'split'}
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </FloatingWindow>
  );
}
