import {
  CreateOrganizationDialog,
  OrganizationsList
} from '@admin/components/admin-organizations';
import { OrganizationScopeSelector } from '@admin/components/admin-scope';
import { useAdminScope } from '@admin/hooks/useAdminScope';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { BackLink } from '@tearleads/ui';
import { Button } from '@/components/ui/button';

interface OrganizationsAdminProps {
  showBackLink?: boolean;
  onOrganizationSelect: (organizationId: string) => void;
}

export function OrganizationsAdmin({
  showBackLink = true,
  onOrganizationSelect
}: OrganizationsAdminProps) {
  const {
    context,
    selectedOrganizationId,
    loading,
    error,
    setSelectedOrganizationId
  } = useAdminScope();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreated = () => {
    setRefreshKey((k) => k + 1);
  };

  const canCreateOrganization = Boolean(context?.isRootAdmin);

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-2xl tracking-tight">
                Organizations Admin
              </h1>
              <p className="text-muted-foreground text-sm">
                Manage organizations
              </p>
            </div>
            {canCreateOrganization ? (
              <Button
                onClick={() => setCreateDialogOpen(true)}
                disabled={loading}
              >
                <Plus className="mr-2 h-4 w-4" />
                Create Organization
              </Button>
            ) : null}
          </div>
          {context ? (
            <OrganizationScopeSelector
              organizations={context.organizations}
              selectedOrganizationId={selectedOrganizationId}
              onSelectOrganization={setSelectedOrganizationId}
              allowAllOrganizations={context.isRootAdmin}
            />
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      ) : null}
      <OrganizationsList
        key={refreshKey}
        onOrganizationSelect={onOrganizationSelect}
        organizationId={selectedOrganizationId}
        onCreateClick={
          canCreateOrganization ? () => setCreateDialogOpen(true) : undefined
        }
      />
      {canCreateOrganization ? (
        <CreateOrganizationDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onCreated={handleCreated}
        />
      ) : null}
    </div>
  );
}
