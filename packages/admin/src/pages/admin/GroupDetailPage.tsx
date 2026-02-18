import type { Group, GroupMember, UpdateGroupRequest } from '@tearleads/shared';
import { Loader2, Save, Trash2, UserMinus, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BackLink } from '@tearleads/ui';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@tearleads/ui';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTypedTranslation } from '@/i18n';
import { api } from '@/lib/api';

interface GroupDetailPageProps {
  groupId?: string;
  backLink?: ReactNode;
  onDelete?: () => void;
}

export function GroupDetailPage({
  groupId: propGroupId,
  backLink,
  onDelete
}: GroupDetailPageProps) {
  const { t } = useTypedTranslation('admin');
  const { id: paramId } = useParams<{ id: string }>();
  const id = propGroupId ?? paramId;
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [description, setDescription] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [removeMemberDialog, setRemoveMemberDialog] =
    useState<GroupMember | null>(null);

  const fetchGroup = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);
      const response = await api.admin.groups.get(id);
      setGroup(response.group);
      setMembers(response.members);
      setName(response.group.name);
      setOrganizationId(response.group.organizationId);
      setDescription(response.group.description ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch group');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchGroup();
  }, [fetchGroup]);

  const handleSave = async () => {
    if (!id || !name.trim()) return;
    const trimmedOrganizationId = organizationId.trim();
    if (!trimmedOrganizationId) {
      setError('Organization ID is required');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const trimmedDescription = description.trim();
      const payload: UpdateGroupRequest = trimmedDescription
        ? { name: name.trim(), description: trimmedDescription }
        : { name: name.trim() };
      if (group && trimmedOrganizationId !== group.organizationId) {
        payload.organizationId = trimmedOrganizationId;
      }
      const response = await api.admin.groups.update(id, payload);
      setGroup(response.group);
      setOrganizationId(response.group.organizationId);
    } catch (err) {
      if (err instanceof Error && err.message.includes('409')) {
        setError('A group with this name already exists');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save group');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    await api.admin.groups.delete(id);
    onDelete?.();
  };

  const handleAddMember = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!id || !addUserId.trim()) return;

    try {
      setAddingMember(true);
      setError(null);
      await api.admin.groups.addMember(id, addUserId.trim());
      setAddUserId('');
      await fetchGroup();
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) {
        setError('User not found');
      } else if (err instanceof Error && err.message.includes('409')) {
        setError('User is already a member of this group');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to add member');
      }
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async () => {
    if (!id || !removeMemberDialog) return;
    await api.admin.groups.removeMember(id, removeMemberDialog.userId);
    setMembers((prev) =>
      prev.filter((m) => m.userId !== removeMemberDialog.userId)
    );
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex h-full flex-col space-y-4">
        <div className="flex items-center gap-2">
          {backLink ?? (
            <BackLink
              defaultTo="/admin/groups"
              defaultLabel={t('backToGroups')}
            />
          )}
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive">{t('groupNotFound')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center gap-2">
        {backLink ?? (
          <BackLink
            defaultTo="/admin/groups"
            defaultLabel={t('backToGroups')}
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-destructive hover:text-destructive"
          onClick={() => setDeleteDialogOpen(true)}
          data-testid="group-delete-button"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <h1 className="font-bold text-lg">{t('editGroup')}</h1>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-lg">{t('details')}</h2>
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="font-medium text-sm">
              Name
            </label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="organization-id" className="font-medium text-sm">
              Organization ID
            </label>
            <Input
              id="organization-id"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="description" className="font-medium text-sm">
              Description
            </label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              rows={3}
            />
          </div>
          <Button
            onClick={() => void handleSave()}
            disabled={saving || !name.trim() || !organizationId.trim()}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-lg">
          {t('members')} ({members.length})
        </h2>

        <form onSubmit={(e) => void handleAddMember(e)} className="flex gap-2">
          <Input
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            placeholder={t('enterUserId')}
            disabled={addingMember}
            className="flex-1"
          />
          <Button type="submit" disabled={addingMember || !addUserId.trim()}>
            {addingMember ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-2 h-4 w-4" />
            )}
            {t('add')}
          </Button>
        </form>

        {members.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground text-sm">
            {t('noMembersYet')}
          </p>
        ) : (
          <div className="space-y-2">
            {members.map((member) => (
              <div
                key={member.userId}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{member.email}</p>
                  <p className="text-muted-foreground text-xs">
                    Joined {new Date(member.joinedAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setRemoveMemberDialog(member)}
                  data-testid={`remove-member-${member.userId}`}
                >
                  <UserMinus className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('deleteGroup')}
        description={t('deleteGroupConfirm', { name: group.name })}
        confirmLabel={t('delete')}
        onConfirm={handleDelete}
        variant="destructive"
      />

      <ConfirmDialog
        open={removeMemberDialog !== null}
        onOpenChange={(open) => !open && setRemoveMemberDialog(null)}
        title={t('removeMember')}
        description={t('removeMemberConfirm', {
          email: removeMemberDialog?.email
        })}
        confirmLabel={t('remove')}
        onConfirm={handleRemoveMember}
        variant="destructive"
      />
    </div>
  );
}
