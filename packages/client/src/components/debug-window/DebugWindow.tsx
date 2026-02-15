import { IconSquare } from '@tearleads/ui';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions
} from '@tearleads/window-manager';
import { Archive, ArrowLeft, Bug, Database, HardDrive } from 'lucide-react';
import { useState } from 'react';
import { CacheStorage } from '@/pages/cache-storage';
import { Debug } from '@/pages/debug';
import { LocalStorage } from '@/pages/localStorage';
import { Opfs } from '@/pages/opfs';
import { type DebugOptionId, DebugOptionsGrid } from './DebugOptionsGrid';
import { DebugWindowMenuBar } from './DebugWindowMenuBar';

type DebugView =
  | 'index'
  | 'system-info'
  | 'browser'
  | 'local-storage'
  | 'opfs'
  | 'cache-storage';

interface DebugWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

const VIEW_TITLES: Record<DebugView, string> = {
  index: 'Debug',
  'system-info': 'System Info',
  browser: 'Browser',
  'local-storage': 'Local Storage',
  opfs: 'OPFS',
  'cache-storage': 'Cache Storage'
};

function getViewTitle(view: DebugView): string {
  return VIEW_TITLES[view] ?? 'Debug';
}

export function DebugWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: DebugWindowProps) {
  const [view, setView] = useState<DebugView>('index');

  const handleOptionSelect = (optionId: DebugOptionId) => {
    setView(optionId);
  };

  const renderControls = () => {
    if (view === 'index') {
      return null;
    }

    // Browser sub-views go back to browser
    if (
      view === 'local-storage' ||
      view === 'opfs' ||
      view === 'cache-storage'
    ) {
      return (
        <WindowControlGroup>
          <WindowControlButton
            icon={<ArrowLeft className="h-3 w-3" />}
            onClick={() => setView('browser')}
            data-testid="debug-window-control-back"
          >
            Back
          </WindowControlButton>
        </WindowControlGroup>
      );
    }

    // Top-level views (system-info, browser) go back to index
    return (
      <WindowControlGroup>
        <WindowControlButton
          icon={<ArrowLeft className="h-3 w-3" />}
          onClick={() => setView('index')}
          data-testid="debug-window-control-back"
        >
          Back
        </WindowControlButton>
      </WindowControlGroup>
    );
  };

  const renderContent = () => {
    switch (view) {
      case 'index':
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Bug className="h-8 w-8 text-muted-foreground" />
              <h1 className="font-bold text-2xl tracking-tight">Debug</h1>
            </div>
            <DebugOptionsGrid onSelect={handleOptionSelect} />
          </div>
        );
      case 'system-info':
        return <Debug showTitle={true} />;
      case 'browser':
        return (
          <div className="space-y-6">
            <h1 className="font-bold text-2xl tracking-tight">Browser</h1>
            <div className="grid grid-cols-2 gap-2 sm:max-w-md lg:grid-cols-3">
              <IconSquare
                icon={Database}
                label="Local Storage"
                onClick={() => setView('local-storage')}
                data-testid="debug-browser-local-storage"
              />
              <IconSquare
                icon={HardDrive}
                label="OPFS"
                onClick={() => setView('opfs')}
                data-testid="debug-browser-opfs"
              />
              <IconSquare
                icon={Archive}
                label="Cache Storage"
                onClick={() => setView('cache-storage')}
                data-testid="debug-browser-cache-storage"
              />
            </div>
          </div>
        );
      case 'local-storage':
        return <LocalStorage showBackLink={false} />;
      case 'opfs':
        return <Opfs showBackLink={false} />;
      case 'cache-storage':
        return <CacheStorage showBackLink={false} />;
      default:
        return null;
    }
  };

  return (
    <FloatingWindow
      id={id}
      title={getViewTitle(view)}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={520}
      defaultHeight={560}
      minWidth={420}
      minHeight={360}
    >
      <div className="flex h-full flex-col">
        <DebugWindowMenuBar onClose={onClose} controls={renderControls()} />
        <div className="flex-1 overflow-auto p-3">{renderContent()}</div>
      </div>
    </FloatingWindow>
  );
}
