import type { UpdateVfsShareRequest, VfsShare } from '@tearleads/shared';
import { Calendar, Loader2, MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVfsExplorerContext } from '../../context';
import { cn } from '../../lib';
import { ShareDeleteConfirmation } from './ShareDeleteConfirmation';
import { SharePermissionSelect } from './SharePermissionSelect';
import {
  formatRelativeTime,
  isExpired,
  isExpiringSoon,
  sharedByLabel
} from './sharingUtils';
import type { DeleteConfirmState, ShareEditState } from './types';
import {
  PERMISSION_COLORS,
  PERMISSION_LABELS,
  SHARE_TYPE_ICONS
} from './types';

interface ShareListItemProps {
  share: VfsShare;
  editState: ShareEditState | null;
  deleteConfirm: DeleteConfirmState | null;
  onStartEdit: (state: ShareEditState) => void;
  onCancelEdit: () => void;
  onSaveEdit: (
    shareId: string,
    request: UpdateVfsShareRequest
  ) => Promise<void>;
  onRequestDelete: (state: DeleteConfirmState) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (shareId: string) => Promise<void>;
}

export function ShareListItem({
  share,
  editState,
  deleteConfirm,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete
}: ShareListItemProps) {
  const {
    ui: { Button, Input },
    auth
  } = useVfsExplorerContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const Icon = SHARE_TYPE_ICONS[share.shareType];
  const isEditing = editState?.shareId === share.id;
  const isDeleting =
    deleteConfirm?.shareId === share.id && !deleteConfirm.isOrg;
  const currentUserId = auth.readStoredAuth().user?.id;

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleSave = useCallback(async () => {
    if (!editState) return;
    setSaving(true);
    try {
      await onSaveEdit(share.id, {
        permissionLevel: editState.permissionLevel,
        expiresAt: editState.expiresAt || null
      });
    } finally {
      setSaving(false);
    }
  }, [editState, onSaveEdit, share.id]);

  if (isDeleting) {
    return (
      <ShareDeleteConfirmation
        targetName={share.targetName}
        onConfirm={() => onConfirmDelete(share.id)}
        onCancel={onCancelDelete}
      />
    );
  }

  if (isEditing && editState) {
    return (
      <div
        className="space-y-2 rounded border bg-muted/20 px-3 py-2"
        data-testid="share-edit-mode"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-sm">
            {share.targetName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Permission:</span>
          <SharePermissionSelect
            value={editState.permissionLevel}
            onChange={(level) =>
              onStartEdit({ ...editState, permissionLevel: level })
            }
          />
        </div>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: Input is a custom component */}
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-muted-foreground text-xs">
            <Calendar className="h-3 w-3" />
            Expires (optional)
          </span>
          <Input
            type="datetime-local"
            value={editState.expiresAt}
            onChange={(e) =>
              onStartEdit({ ...editState, expiresAt: e.target.value })
            }
            className="text-base"
          />
        </label>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancelEdit}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 rounded border bg-muted/20 px-2 py-1.5"
      data-testid="share-list-item"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{share.targetName}</div>
        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <span>{sharedByLabel(share.createdBy, currentUserId)}</span>
          <span>&middot;</span>
          <span>{formatRelativeTime(share.createdAt)}</span>
        </div>
        {share.expiresAt && (
          <div
            className={cn(
              'text-xs',
              isExpired(share.expiresAt)
                ? 'text-destructive'
                : isExpiringSoon(share.expiresAt)
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground'
            )}
          >
            {isExpired(share.expiresAt)
              ? 'Expired'
              : `Expires ${new Date(share.expiresAt).toLocaleDateString()}`}
          </div>
        )}
      </div>
      <span
        className={cn(
          'shrink-0 rounded px-1.5 py-0.5 text-xs',
          PERMISSION_COLORS[share.permissionLevel]
        )}
      >
        {PERMISSION_LABELS[share.permissionLevel]}
      </span>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setMenuOpen((prev) => !prev)}
          data-testid="share-item-menu"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute top-full right-0 z-20 mt-1 w-28 rounded border bg-background shadow-lg">
            <button
              type="button"
              className="flex w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => {
                setMenuOpen(false);
                onStartEdit({
                  shareId: share.id,
                  permissionLevel: share.permissionLevel,
                  expiresAt: share.expiresAt ?? ''
                });
              }}
              data-testid="share-item-edit"
            >
              Edit
            </button>
            <button
              type="button"
              className="flex w-full px-3 py-1.5 text-left text-destructive text-sm hover:bg-accent"
              onClick={() => {
                setMenuOpen(false);
                onRequestDelete({
                  shareId: share.id,
                  targetName: share.targetName,
                  isOrg: false
                });
              }}
              data-testid="share-item-remove"
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
