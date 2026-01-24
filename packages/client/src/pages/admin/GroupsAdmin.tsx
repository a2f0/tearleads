import { Plus } from 'lucide-react';
import { useState } from 'react';
import { CreateGroupDialog, GroupsList } from '@/components/admin-groups';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';

interface GroupsAdminProps {
  showBackLink?: boolean;
}

export function GroupsAdmin({ showBackLink = true }: GroupsAdminProps) {
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
            <h1 className="font-bold text-2xl tracking-tight">Groups Admin</h1>
            <p className="text-muted-foreground text-sm">Manage user groups</p>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Group
          </Button>
        </div>
      </div>
      <GroupsList
        key={refreshKey}
        onCreateClick={() => setCreateDialogOpen(true)}
      />
      <CreateGroupDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}
