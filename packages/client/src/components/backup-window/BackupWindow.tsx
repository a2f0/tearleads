import { useState } from 'react';

import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { BackupWindowMenuBar } from './BackupWindowMenuBar';
import { CreateBackupTab } from './CreateBackupTab';
import { RestoreBackupTab } from './RestoreBackupTab';

interface BackupWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

type Tab = 'create' | 'restore';

export function BackupWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: BackupWindowProps) {
  const [activeTab, setActiveTab] = useState<Tab>('create');

  return (
    <FloatingWindow
      id={id}
      title="Backup Manager"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={480}
      defaultHeight={420}
      minWidth={400}
      minHeight={320}
    >
      <div className="flex h-full flex-col">
        <BackupWindowMenuBar onClose={onClose} />

        {/* Tab buttons */}
        <div className="flex gap-1 border-zinc-700 border-b px-4 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`rounded-md px-4 py-1.5 font-medium text-sm transition-colors ${
              activeTab === 'create'
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'
            }`}
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('restore')}
            className={`rounded-md px-4 py-1.5 font-medium text-sm transition-colors ${
              activeTab === 'restore'
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'
            }`}
          >
            Restore
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'create' && <CreateBackupTab />}
          {activeTab === 'restore' && <RestoreBackupTab />}
        </div>
      </div>
    </FloatingWindow>
  );
}
