import {
  CreateOrganizationDialog,
  OrganizationsList
} from '@admin/components/admin-organizations';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';

interface OrganizationsAdminProps {
  showBackLink?: boolean;
  onOrganizationSelect: (organizationId: string) => void;
}

export function OrganizationsAdmin({
  showBackLink = true,
  onOrganizationSelect
}: OrganizationsAdminProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreated = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-2xl tracking-tight">
              Organizations Admin
            </h1>
            <p className="text-muted-foreground text-sm">
              Manage organizations
            </p>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Organization
          </Button>
        </div>
      </div>
      <OrganizationsList
        key={refreshKey}
        onCreateClick={() => setCreateDialogOpen(true)}
        onOrganizationSelect={onOrganizationSelect}
      />
      <CreateOrganizationDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}
