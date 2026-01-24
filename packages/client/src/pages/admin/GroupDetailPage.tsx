import type { Group, GroupMember } from '@rapid/shared';
import { Loader2, Save, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [removeMemberDialog, setRemoveMemberDialog] = useState<GroupMember | null>(
    null
  );

  const fetchGroup = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);
      const response = await api.admin.groups.get(id);
      setGroup(response.group);
      setMembers(response.members);
      setName(response.group.name);
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

    try {
      setSaving(true);
      setError(null);
      const trimmedDescription = description.trim();
      const response = await api.admin.groups.update(
        id,
        trimmedDescription
          ? { name: name.trim(), description: trimmedDescription }
          : { name: name.trim() }
      );
      setGroup(response.group);
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
    navigate('/admin/groups');
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
      <div className="flex h-full flex-col space-y-6">
        <BackLink defaultTo="/admin/groups" defaultLabel="Back to Groups" />
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive">Group not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/admin/groups" defaultLabel="Back to Groups" />
        <div className="flex items-center justify-between">
          <h1 className="font-bold text-2xl tracking-tight">Edit Group</h1>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-lg">Details</h2>
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
            <label htmlFor="description" className="font-medium text-sm">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-lg">Members ({members.length})</h2>

        <form
          onSubmit={(e) => void handleAddMember(e)}
          className="flex gap-2"
        >
          <Input
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            placeholder="Enter user ID"
            disabled={addingMember}
            className="flex-1"
          />
          <Button type="submit" disabled={addingMember || !addUserId.trim()}>
            {addingMember ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-2 h-4 w-4" />
            )}
            Add
          </Button>
        </form>

        {members.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground text-sm">
            No members yet
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
        title="Delete Group"
        description={`Are you sure you want to delete "${group.name}"? This will remove all members from the group.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        variant="destructive"
      />

      <ConfirmDialog
        open={removeMemberDialog !== null}
        onOpenChange={(open) => !open && setRemoveMemberDialog(null)}
        title="Remove Member"
        description={`Remove ${removeMemberDialog?.email} from this group?`}
        confirmLabel="Remove"
        onConfirm={handleRemoveMember}
        variant="destructive"
      />
    </div>
  );
}
