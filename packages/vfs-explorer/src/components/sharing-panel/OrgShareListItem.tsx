import type { VfsOrgShare } from '@tearleads/shared';
import { Building2, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib';
import { ShareDeleteConfirmation } from './ShareDeleteConfirmation';
import { formatRelativeTime, isExpired, isExpiringSoon } from './sharingUtils';
import type { DeleteConfirmState } from './types';
import { PERMISSION_COLORS, PERMISSION_LABELS } from './types';

interface OrgShareListItemProps {
  share: VfsOrgShare;
  deleteConfirm: DeleteConfirmState | null;
  onRequestDelete: (state: DeleteConfirmState) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (shareId: string) => Promise<void>;
}

export function OrgShareListItem({
  share,
  deleteConfirm,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete
}: OrgShareListItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isDeleting = deleteConfirm?.shareId === share.id && deleteConfirm.isOrg;

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

  if (isDeleting) {
    return (
      <ShareDeleteConfirmation
        targetName={share.targetOrgName}
        onConfirm={() => onConfirmDelete(share.id)}
        onCancel={onCancelDelete}
      />
    );
  }

  const sharedByText = `From ${share.sourceOrgName}`;

  return (
    <div
      className="flex items-center gap-2 rounded border bg-muted/20 px-2 py-1.5"
      data-testid="org-share-list-item"
    >
      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">
          Shared with {share.targetOrgName}
        </div>
        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <span>{sharedByText}</span>
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
          data-testid="org-share-item-menu"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute top-full right-0 z-20 mt-1 w-28 rounded border bg-background shadow-lg">
            <button
              type="button"
              className="flex w-full px-3 py-1.5 text-left text-destructive text-sm hover:bg-accent"
              onClick={() => {
                setMenuOpen(false);
                onRequestDelete({
                  shareId: share.id,
                  targetName: share.targetOrgName,
                  isOrg: true
                });
              }}
              data-testid="org-share-item-remove"
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
