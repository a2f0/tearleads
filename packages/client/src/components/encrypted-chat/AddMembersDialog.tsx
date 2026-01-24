import { Check, UserPlus, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface UserInfo {
  id: string;
  email: string;
  displayName?: string;
}

interface AddMembersDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (userIds: string[]) => Promise<void>;
  availableUsers: UserInfo[];
  existingMemberIds: string[];
}

export function AddMembersDialog({
  isOpen,
  onClose,
  onAdd,
  availableUsers,
  existingMemberIds
}: AddMembersDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleUsers = availableUsers.filter(
    (user) => !existingMemberIds.includes(user.id)
  );

  const filteredUsers = eligibleUsers.filter(
    (user) =>
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.displayName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleUser = useCallback((userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  const handleAdd = useCallback(async () => {
    if (selectedIds.size === 0) {
      setError('Please select at least one user');
      return;
    }

    setIsAdding(true);
    setError(null);

    try {
      await onAdd(Array.from(selectedIds));
      setSelectedIds(new Set());
      setSearchQuery('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add members');
    } finally {
      setIsAdding(false);
    }
  }, [selectedIds, onAdd, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg"
        role="dialog"
        aria-labelledby="add-members-title"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            <h2 id="add-members-title" className="font-semibold text-lg">
              Add Members
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="user-search"
              className="font-medium text-sm leading-none"
            >
              Search Users
            </label>
            <Input
              id="user-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by email or name"
              disabled={isAdding}
              autoFocus
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border">
            {filteredUsers.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                {eligibleUsers.length === 0
                  ? 'No more users available to add'
                  : 'No users match your search'}
              </div>
            ) : (
              filteredUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => toggleUser(user.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 hover:bg-accent/50"
                  disabled={isAdding}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-sm">
                    {(user.displayName ?? user.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="truncate font-medium">
                      {user.displayName ?? user.email.split('@')[0]}
                    </div>
                    <div className="truncate text-muted-foreground text-sm">
                      {user.email}
                    </div>
                  </div>
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded border ${
                      selectedIds.has(user.id)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground'
                    }`}
                  >
                    {selectedIds.has(user.id) && <Check className="h-3 w-3" />}
                  </div>
                </button>
              ))
            )}
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isAdding}>
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={isAdding || selectedIds.size === 0}
            >
              {isAdding
                ? 'Adding...'
                : `Add ${selectedIds.size > 0 ? selectedIds.size : ''} Member${selectedIds.size !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
