import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { AdminWindowMenuBar } from '@/components/admin-window/AdminWindowMenuBar';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { OrganizationDetailPage } from '@/pages/admin/OrganizationDetailPage';
import { OrganizationsAdmin } from '@/pages/admin/OrganizationsAdmin';

type OrganizationsWindowView =
  | { type: 'index' }
  | { type: 'organization'; organizationId: string };

interface AdminOrganizationsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AdminOrganizationsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: AdminOrganizationsWindowProps) {
  const [view, setView] = useState<OrganizationsWindowView>({ type: 'index' });

  const title =
    view.type === 'index' ? 'Organizations Admin' : 'Edit Organization';

  const handleOrganizationSelect = (organizationId: string) => {
    setView({ type: 'organization', organizationId });
  };

  const handleBack = () => {
    setView({ type: 'index' });
  };

  return (
    <FloatingWindow
      id={id}
      title={title}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={720}
      defaultHeight={600}
      minWidth={520}
      minHeight={420}
    >
      <div className="flex h-full flex-col">
        <AdminWindowMenuBar onClose={onClose} />
        <div className="flex-1 overflow-auto p-3">
          {view.type === 'index' ? (
            <OrganizationsAdmin
              showBackLink={false}
              onOrganizationSelect={handleOrganizationSelect}
            />
          ) : (
            <OrganizationDetailPage
              organizationId={view.organizationId}
              onDelete={handleBack}
              backLink={
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Organizations
                </button>
              }
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
