import type { Organization } from '@rapid/shared';
import { Building2, Loader2, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { api } from '@/lib/api';

interface OrganizationsListProps {
  onCreateClick?: () => void;
  onOrganizationSelect: (organizationId: string) => void;
}

export function OrganizationsList({
  onCreateClick,
  onOrganizationSelect
}: OrganizationsListProps) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    organization: Organization;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<Organization | null>(null);

  const fetchOrganizations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.admin.organizations.list();
      setOrganizations(response.organizations);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch organizations'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOrganizations();
  }, [fetchOrganizations]);

  const handleContextMenu = (
    e: React.MouseEvent,
    organization: Organization
  ) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, organization });
  };

  const handleDelete = async () => {
    if (!deleteDialog) return;

    await api.admin.organizations.delete(deleteDialog.id);
    setOrganizations((prev) =>
      prev.filter((organization) => organization.id !== deleteDialog.id)
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-destructive text-sm">{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void fetchOrganizations()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
        <Building2 className="h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 font-medium text-lg">No organizations yet</h3>
        <p className="mt-1 text-muted-foreground text-sm">
          Create an organization to manage access
        </p>
        {onCreateClick && (
          <Button className="mt-4" onClick={onCreateClick}>
            <Plus className="mr-2 h-4 w-4" />
            Create Organization
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {organizations.map((organization) => (
          <button
            key={organization.id}
            type="button"
            onClick={() => onOrganizationSelect(organization.id)}
            onContextMenu={(e) => handleContextMenu(e, organization)}
            className="flex w-full items-center justify-between rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent"
          >
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-medium">{organization.name}</h3>
              {organization.description && (
                <p className="mt-1 truncate text-muted-foreground text-sm">
                  {organization.description}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <ContextMenuItem
            onClick={() => {
              setDeleteDialog(contextMenu.organization);
              setContextMenu(null);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4 text-destructive" />
            <span className="text-destructive">Delete</span>
          </ContextMenuItem>
        </ContextMenu>
      )}

      <ConfirmDialog
        open={deleteDialog !== null}
        onOpenChange={(open) => !open && setDeleteDialog(null)}
        title="Delete Organization"
        description={`Are you sure you want to delete "${deleteDialog?.name}"? This will remove all organization memberships.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        variant="destructive"
      />
    </>
  );
}
