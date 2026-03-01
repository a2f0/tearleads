import type {
  UpdateVfsShareRequest,
  VfsOrgShare,
  VfsShare
} from '@tearleads/shared';
import { Loader2 } from 'lucide-react';
import { OrgShareListItem } from './OrgShareListItem';
import { ShareListItem } from './ShareListItem';
import type { DeleteConfirmState, ShareEditState } from './types';

interface ShareListProps {
  shares: VfsShare[];
  orgShares: VfsOrgShare[];
  loading: boolean;
  error: string | null;
  editState: ShareEditState | null;
  deleteConfirm: DeleteConfirmState | null;
  onStartEdit: (state: ShareEditState) => void;
  onCancelEdit: () => void;
  onSaveEdit: (shareId: string, request: UpdateVfsShareRequest) => Promise<void>;
  onRequestDelete: (state: DeleteConfirmState) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (shareId: string, isOrg: boolean) => Promise<void>;
}

export function ShareList({
  shares,
  orgShares,
  loading,
  error,
  editState,
  deleteConfirm,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete
}: ShareListProps) {
  const totalCount = shares.length + orgShares.length;

  return (
    <div className="flex-1 overflow-y-auto">
      {loading && totalCount === 0 && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-destructive text-xs">{error}</div>
      )}

      {!loading && totalCount === 0 && (
        <div
          className="px-6 py-8 text-center text-muted-foreground text-sm"
          data-testid="share-list-empty"
        >
          This item hasn&apos;t been shared yet.
          <br />
          Click <span className="font-medium">Share</span> above to give
          someone access.
        </div>
      )}

      {totalCount > 0 && (
        <>
          <div className="px-3 py-2">
            <span className="font-medium text-muted-foreground text-xs">
              People &amp; Groups
            </span>
          </div>
          <div className="space-y-1 px-2 pb-2">
            {shares.map((share) => (
              <ShareListItem
                key={share.id}
                share={share}
                editState={
                  editState?.shareId === share.id ? editState : null
                }
                deleteConfirm={
                  deleteConfirm?.shareId === share.id &&
                  !deleteConfirm.isOrg
                    ? deleteConfirm
                    : null
                }
                onStartEdit={onStartEdit}
                onCancelEdit={onCancelEdit}
                onSaveEdit={onSaveEdit}
                onRequestDelete={onRequestDelete}
                onCancelDelete={onCancelDelete}
                onConfirmDelete={(id) => onConfirmDelete(id, false)}
              />
            ))}
            {orgShares.map((share) => (
              <OrgShareListItem
                key={share.id}
                share={share}
                deleteConfirm={
                  deleteConfirm?.shareId === share.id &&
                  deleteConfirm.isOrg
                    ? deleteConfirm
                    : null
                }
                onRequestDelete={onRequestDelete}
                onCancelDelete={onCancelDelete}
                onConfirmDelete={(id) => onConfirmDelete(id, true)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
