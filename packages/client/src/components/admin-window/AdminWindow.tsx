import { useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { cn } from '@/lib/utils';
import { Admin } from '@/pages/admin/Admin';
import { AdminWindowMenuBar } from './AdminWindowMenuBar';

interface AdminWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function AdminWindow({
  id,
  onClose,
  onMinimize,
  onFocus,
  zIndex,
  initialDimensions
}: AdminWindowProps) {
  const [compact, setCompact] = useState(false);

  return (
    <FloatingWindow
      id={id}
      title="Admin"
      onClose={onClose}
      onMinimize={onMinimize}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={600}
      minWidth={500}
      minHeight={400}
    >
      <div className="flex h-full flex-col">
        <AdminWindowMenuBar
          compact={compact}
          onCompactChange={setCompact}
          onClose={onClose}
        />
        <div className={cn('flex-1 overflow-auto', compact ? 'p-3' : 'p-6')}>
          <Admin />
        </div>
      </div>
    </FloatingWindow>
  );
}
