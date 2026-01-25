import type { Organization, UpdateOrganizationRequest } from '@rapid/shared';
import { Loader2, Save, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';

interface OrganizationDetailPageProps {
  organizationId?: string;
  backLink?: ReactNode;
  onDelete?: () => void;
}

export function OrganizationDetailPage({
  organizationId: organizationIdProp,
  backLink,
  onDelete
}: OrganizationDetailPageProps) {
  const { id: paramId } = useParams<{ id: string }>();
  const id = organizationIdProp ?? paramId;
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const fetchOrganization = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);
      const response = await api.admin.organizations.get(id);
      setOrganization(response.organization);
      setName(response.organization.name);
      setDescription(response.organization.description ?? '');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch organization'
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchOrganization();
  }, [fetchOrganization]);

  const handleSave = async () => {
    if (!id || !name.trim()) return;

    try {
      setSaving(true);
      setError(null);
      const trimmedDescription = description.trim();
      const payload: UpdateOrganizationRequest = { name: name.trim() };
      if (trimmedDescription) {
        payload.description = trimmedDescription;
      }
      const response = await api.admin.organizations.update(id, payload);
      setOrganization(response.organization);
    } catch (err) {
      if (err instanceof Error && err.message.includes('409')) {
        setError('An organization with this name already exists');
      } else {
        setError(
          err instanceof Error ? err.message : 'Failed to save organization'
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    await api.admin.organizations.delete(id);
    onDelete?.();
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="flex h-full flex-col space-y-4">
        <div className="flex items-center gap-2">
          {backLink ?? (
            <BackLink
              defaultTo="/admin/organizations"
              defaultLabel="Back to Organizations"
            />
          )}
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive">Organization not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center gap-2">
        {backLink ?? (
          <BackLink
            defaultTo="/admin/organizations"
            defaultLabel="Back to Organizations"
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-destructive hover:text-destructive"
          onClick={() => setDeleteDialogOpen(true)}
          data-testid="organization-delete-button"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <h1 className="font-bold text-lg">Edit Organization</h1>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-lg">Details</h2>
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="org-name" className="font-medium text-sm">
              Name
            </label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="org-description" className="font-medium text-sm">
              Description
            </label>
            <Textarea
              id="org-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              rows={3}
            />
          </div>
          <Button
            onClick={() => void handleSave()}
            disabled={saving || !name.trim()}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Organization"
        description={`Are you sure you want to delete "${organization.name}"? This will remove all organization memberships.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        variant="destructive"
      />
    </div>
  );
}
