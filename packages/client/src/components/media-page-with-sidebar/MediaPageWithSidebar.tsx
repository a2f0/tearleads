import type { ReactNode } from 'react';
import { BackLink } from '@/components/ui/back-link';

interface MediaPageWithSidebarProps {
  showSidebar: boolean;
  sidebar: ReactNode;
  content: ReactNode;
}

export function MediaPageWithSidebar({
  showSidebar,
  sidebar,
  content
}: MediaPageWithSidebarProps) {
  return (
    <div className="flex h-full flex-col space-y-4">
      <BackLink defaultTo="/" defaultLabel="Back to Home" />
      <div className="flex min-h-0 flex-1">
        {showSidebar && <div className="hidden md:block">{sidebar}</div>}
        <div className="min-w-0 flex-1 overflow-hidden md:pl-4">{content}</div>
      </div>
    </div>
  );
}
