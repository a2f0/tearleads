import type { Organization } from '@tearleads/shared';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem,
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { Building2, Copy, Loader2, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useTypedTranslation } from '@/i18n';
import { api } from '@/lib/api';

interface OrganizationsListProps {
  onCreateClick?: (() => void) | undefined;
  onOrganizationSelect: (organizationId: string) => void;
  organizationId?: string | null;
}

export function OrganizationsList({
  onCreateClick,
  onOrganizationSelect,
  organizationId
}: OrganizationsListProps) {
  const { t } = useTypedTranslation('admin');
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
      const response = await api.admin.organizations.list(
        organizationId ? { organizationId } : undefined
      );
      setOrganizations(response.organizations);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch organizations'
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

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

  const handleCopyId = async (organization: Organization) => {
    try {
      await navigator.clipboard.writeText(organization.id);
      toast.success('Organization ID copied.');
    } catch (err) {
      console.error('Failed to copy organization id:', err);
      toast.error('Failed to copy organization ID.');
    } finally {
      setContextMenu(null);
    }
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
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
        <Building2 className="h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 font-medium text-lg">{t('noOrganizationsYet')}</h3>
        <p className="mt-1 text-muted-foreground text-sm">
          {t('createOrganizationToManageAccess')}
        </p>
        {onCreateClick && (
          <Button className="mt-4" onClick={onCreateClick}>
            <Plus className="mr-2 h-4 w-4" />
            {t('createOrganization')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-auto rounded-lg border">
        <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
          <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
            <tr>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>ID</th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('name')}
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('description')}
              </th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((organization) => (
              <WindowTableRow
                key={organization.id}
                onClick={() => onOrganizationSelect(organization.id)}
                onContextMenu={(e) => handleContextMenu(e, organization)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOrganizationSelect(organization.id);
                  }
                }}
              >
                <td
                  className={`max-w-[120px] ${WINDOW_TABLE_TYPOGRAPHY.mutedCell}`}
                >
                  <span className="block truncate font-mono text-muted-foreground">
                    {organization.id}
                  </span>
                </td>
                <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">
                      {organization.name}
                    </span>
                  </div>
                </td>
                <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                  {organization.description ? (
                    <span className="block truncate">
                      {organization.description}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/70">—</span>
                  )}
                </td>
              </WindowTableRow>
            ))}
          </tbody>
        </table>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <ContextMenuItem
            icon={<Copy className="h-4 w-4" />}
            onClick={() => handleCopyId(contextMenu.organization)}
          >
            {t('copyId')}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              setDeleteDialog(contextMenu.organization);
              setContextMenu(null);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4 text-destructive" />
            <span className="text-destructive">{t('delete')}</span>
          </ContextMenuItem>
        </ContextMenu>
      )}

      <ConfirmDialog
        open={deleteDialog !== null}
        onOpenChange={(open) => !open && setDeleteDialog(null)}
        title={t('deleteOrganization')}
        description={t('deleteOrganizationConfirm', {
          name: deleteDialog?.name
        })}
        confirmLabel={t('delete')}
        onConfirm={handleDelete}
        variant="destructive"
      />
    </>
  );
}
