import type {
  Organization,
  OrganizationGroup,
  OrganizationUser,
  UpdateOrganizationRequest
} from '@tearleads/shared';
import { BackLink, ConfirmDialog } from '@tearleads/ui';
import {
  Building2,
  Calendar,
  Check,
  Copy,
  Loader2,
  Pencil,
  Save,
  Trash2,
  Users,
  X
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTypedTranslation } from '@/i18n';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface OrganizationFormData {
  name: string;
  description: string;
}

interface OrganizationDetailPageProps {
  organizationId?: string;
  backLink?: ReactNode;
  onDelete?: () => void;
  onUserSelect?: (userId: string) => void;
  onGroupSelect?: (groupId: string) => void;
}

export function OrganizationDetailPage({
  organizationId: organizationIdProp,
  backLink,
  onDelete,
  onUserSelect,
  onGroupSelect
}: OrganizationDetailPageProps) {
  const { t } = useTypedTranslation('admin');
  const { id: paramId } = useParams<{ id: string }>();
  const id = organizationIdProp ?? paramId;
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [users, setUsers] = useState<OrganizationUser[]>([]);
  const [groups, setGroups] = useState<OrganizationGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isIdCopied, setIsIdCopied] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<OrganizationFormData | null>(null);

  const fetchOrganization = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);
      const [orgResult, usersResult, groupsResult] = await Promise.allSettled([
        api.admin.organizations.get(id),
        api.admin.organizations.getUsers(id),
        api.admin.organizations.getGroups(id)
      ]);

      if (orgResult.status === 'fulfilled') {
        setOrganization(orgResult.value.organization);
      } else {
        setError(
          orgResult.reason instanceof Error
            ? orgResult.reason.message
            : 'Failed to fetch organization'
        );
      }

      if (usersResult.status === 'fulfilled') {
        setUsers(usersResult.value.users);
      }

      if (groupsResult.status === 'fulfilled') {
        setGroups(groupsResult.value.groups);
      }
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

  useEffect(() => {
    if (!isIdCopied) return;

    const timerId = setTimeout(() => {
      setIsIdCopied(false);
    }, 2000);

    return () => clearTimeout(timerId);
  }, [isIdCopied]);

  const handleEditClick = useCallback(() => {
    if (!organization) return;
    setFormData({
      name: organization.name,
      description: organization.description ?? ''
    });
    setIsEditing(true);
    setError(null);
  }, [organization]);

  const handleCancel = useCallback(() => {
    setFormData(null);
    setIsEditing(false);
    setError(null);
  }, []);

  const handleFormChange = useCallback(
    (field: keyof OrganizationFormData, value: string) => {
      setFormData((prev) => (prev ? { ...prev, [field]: value } : null));
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!id || !formData || !formData.name.trim()) return;

    try {
      setSaving(true);
      setError(null);
      const trimmedDescription = formData.description.trim();
      const payload: UpdateOrganizationRequest = { name: formData.name.trim() };
      if (trimmedDescription) {
        payload.description = trimmedDescription;
      }
      const response = await api.admin.organizations.update(id, payload);
      setOrganization(response.organization);
      setIsEditing(false);
      setFormData(null);
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
  }, [id, formData]);

  const handleDelete = async () => {
    if (!id) return;
    await api.admin.organizations.delete(id);
    onDelete?.();
  };

  const handleCopyId = useCallback(() => {
    if (!organization) return;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(organization.id);
        setIsIdCopied(true);
        toast.success('Organization ID copied.');
      } catch (err) {
        console.error('Failed to copy organization id:', err);
        toast.error('Failed to copy organization ID.');
      }
    };

    void copy();
  }, [organization]);

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
              defaultLabel={t('backToOrganizations')}
            />
          )}
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive">{t('organizationNotFound')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        {backLink ?? (
          <BackLink
            defaultTo="/admin/organizations"
            defaultLabel={t('backToOrganizations')}
          />
        )}
        {!isEditing && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleEditClick}
              className="h-7 px-2"
              data-testid="organization-edit-button"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-destructive hover:text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
              data-testid="organization-delete-button"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
        {isEditing && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={saving}
              className="h-7 px-2"
              data-testid="organization-cancel-button"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !formData?.name.trim()}
              className="h-7 px-2"
              data-testid="organization-save-button"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      {/* Organization Info */}
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-mono text-muted-foreground text-xs">
                {organization.id}
              </p>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopyId}
                aria-label={t('copyOrganizationIdToClipboard')}
                data-testid="copy-organization-id"
              >
                {isIdCopied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            {isEditing && formData ? (
              <div className="space-y-2">
                <Input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                  placeholder={t('organizationName')}
                  className="h-8 text-sm"
                  data-testid="organization-edit-name"
                />
                <Textarea
                  value={formData.description}
                  onChange={(e) =>
                    handleFormChange('description', e.target.value)
                  }
                  placeholder={t('description')}
                  className="text-sm"
                  rows={2}
                  data-testid="organization-edit-description"
                />
              </div>
            ) : (
              <>
                <h1 className="font-bold text-lg">{organization.name}</h1>
                {organization.description && (
                  <p className="text-muted-foreground text-sm">
                    {organization.description}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Users Section */}
      {!isEditing && (
        <div className="rounded-lg border text-sm">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Users ({users.length})</h2>
          </div>
          {users.length === 0 ? (
            <div className="px-3 py-4 text-center text-muted-foreground text-sm">
              No users in this organization
            </div>
          ) : (
            <div className="divide-y">
              {users.map((user) => {
                const content = (
                  <>
                    <span className="flex-1 truncate">{user.email}</span>
                    <span className="text-muted-foreground text-xs">
                      Joined {formatDate(new Date(user.joinedAt))}
                    </span>
                  </>
                );

                return onUserSelect ? (
                  <button
                    key={user.id}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
                    onClick={() => onUserSelect(user.id)}
                    data-testid={`organization-user-${user.id}`}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    key={user.id}
                    className="flex items-center gap-2 px-3 py-2"
                    data-testid={`organization-user-${user.id}`}
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Groups Section */}
      {!isEditing && (
        <div className="rounded-lg border text-sm">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Groups ({groups.length})</h2>
          </div>
          {groups.length === 0 ? (
            <div className="px-3 py-4 text-center text-muted-foreground text-sm">
              No groups in this organization
            </div>
          ) : (
            <div className="divide-y">
              {groups.map((group) => {
                const content = (
                  <>
                    <span className="flex-1 truncate">{group.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {group.memberCount}{' '}
                      {group.memberCount === 1 ? 'member' : 'members'}
                    </span>
                  </>
                );

                return onGroupSelect ? (
                  <button
                    key={group.id}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
                    onClick={() => onGroupSelect(group.id)}
                    data-testid={`organization-group-${group.id}`}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    key={group.id}
                    className="flex items-center gap-2 px-3 py-2"
                    data-testid={`organization-group-${group.id}`}
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Details Section */}
      {!isEditing && (
        <div className="rounded-lg border text-sm">
          <div className="border-b px-3 py-2">
            <h2 className="font-medium">{t('details')}</h2>
          </div>
          <div className="divide-y">
            <div className="flex items-center gap-2 px-3 py-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t('created')}</span>
              <span className="ml-auto">
                {formatDate(new Date(organization.createdAt))}
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t('updated')}</span>
              <span className="ml-auto">
                {formatDate(new Date(organization.updatedAt))}
              </span>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('deleteOrganization')}
        description={t('deleteOrganizationConfirm', {
          name: organization.name
        })}
        confirmLabel={t('delete')}
        onConfirm={handleDelete}
        variant="destructive"
      />
    </div>
  );
}
