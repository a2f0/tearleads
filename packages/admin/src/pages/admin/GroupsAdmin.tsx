import { CreateGroupDialog, GroupsList } from '@admin/components/admin-groups';
import { OrganizationScopeSelector } from '@admin/components/admin-scope';
import { useAdminScope } from '@admin/hooks/useAdminScope';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { BackLink } from '@tearleads/ui';
import { Button } from '@/components/ui/button';

interface GroupsAdminProps {
  showBackLink?: boolean;
  onGroupSelect: (groupId: string) => void;
}

export function GroupsAdmin({
  showBackLink = true,
  onGroupSelect
}: GroupsAdminProps) {
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

  const canCreateGroup = (context?.organizations.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-2xl tracking-tight">
                Groups Admin
              </h1>
              <p className="text-muted-foreground text-sm">
                Manage user groups
              </p>
            </div>
            <Button
              onClick={() => setCreateDialogOpen(true)}
              disabled={loading || !canCreateGroup}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Group
            </Button>
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
      <GroupsList
        key={refreshKey}
        onGroupSelect={onGroupSelect}
        organizationId={selectedOrganizationId}
        onCreateClick={
          canCreateGroup ? () => setCreateDialogOpen(true) : undefined
        }
      />
      <CreateGroupDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={handleCreated}
        organizations={context?.organizations ?? []}
        defaultOrganizationId={selectedOrganizationId}
      />
    </div>
  );
}
