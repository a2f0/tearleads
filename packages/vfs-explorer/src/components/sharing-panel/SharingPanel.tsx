import type { UpdateVfsShareRequest, VfsShareType } from '@tearleads/shared';
import { useResizableSidebar } from '@tearleads/window-manager';
import { Plus, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useVfsExplorerContext } from '../../context';
import { useVfsShares } from '../../hooks';
import { ShareAccessSummary } from './ShareAccessSummary';
import { ShareForm } from './ShareForm';
import { ShareList } from './ShareList';
import type {
  DeleteConfirmState,
  ShareEditState,
  SharingPanelProps
} from './types';

interface FormTarget {
  shareType: VfsShareType;
  targetId: string | null;
  targetName: string;
}

export function SharingPanel({
  item,
  width,
  onWidthChange,
  onClose
}: SharingPanelProps) {
  const {
    ui: { Button }
  } = useVfsExplorerContext();
  const {
    shares,
    orgShares,
    loading,
    error,
    createShare,
    updateShare,
    deleteShare,
    deleteOrgShare
  } = useVfsShares(item.id);

  const [showForm, setShowForm] = useState(false);
  const [editingShare, setEditingShare] = useState<ShareEditState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(
    null
  );
  const [formTarget, setFormTarget] = useState<FormTarget>({
    shareType: 'user',
    targetId: null,
    targetName: ''
  });

  const { resizeHandleProps } = useResizableSidebar({
    width,
    onWidthChange,
    resizeFrom: 'left',
    minWidth: 250,
    maxWidth: 500,
    ariaLabel: 'Resize sharing panel'
  });

  const totalCount = shares.length + orgShares.length;

  const handleShareCreated = useCallback(() => {
    setShowForm(false);
    setFormTarget({ shareType: 'user', targetId: null, targetName: '' });
  }, []);

  const handleFormCancel = useCallback(() => {
    setShowForm(false);
    setFormTarget({ shareType: 'user', targetId: null, targetName: '' });
  }, []);

  const handleTargetSelected = useCallback(
    (shareType: VfsShareType, targetId: string | null, targetName: string) => {
      setFormTarget({ shareType, targetId, targetName });
    },
    []
  );

  const handleSaveEdit = useCallback(
    async (shareId: string, request: UpdateVfsShareRequest) => {
      await updateShare(shareId, request);
      setEditingShare(null);
    },
    [updateShare]
  );

  const handleConfirmDelete = useCallback(
    async (shareId: string, isOrg: boolean) => {
      if (isOrg) {
        await deleteOrgShare(shareId);
      } else {
        await deleteShare(shareId);
      }
      setDeleteConfirm(null);
    },
    [deleteShare, deleteOrgShare]
  );

  return (
    <div
      className="relative flex shrink-0 flex-col border-l bg-background [border-color:var(--soft-border)]"
      style={{ width }}
      data-testid="sharing-panel"
    >
      {/* Resize handle */}
      <div
        className="absolute top-0 bottom-0 left-0 w-1 cursor-col-resize hover:bg-accent"
        {...resizeHandleProps}
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2 [border-color:var(--soft-border)]">
        <span className="truncate font-medium text-sm">
          Sharing: {item.name}
        </span>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between border-b px-3 py-2 [border-color:var(--soft-border)]">
        <span className="text-muted-foreground text-xs">
          {totalCount === 0
            ? 'Not shared'
            : `${totalCount} ${totalCount === 1 ? 'person has' : 'people have'} access`}
        </span>
        {!showForm && (
          <Button
            size="sm"
            onClick={() => setShowForm(true)}
            data-testid="open-share-form"
          >
            <Plus className="mr-1 h-3 w-3" />
            Share
          </Button>
        )}
      </div>

      {/* Collapsible share form */}
      {showForm && (
        <ShareForm
          onShareCreated={handleShareCreated}
          onCancel={handleFormCancel}
          onTargetSelected={handleTargetSelected}
          createShare={createShare}
        />
      )}

      {/* Access summary (only when form is open with a target selected) */}
      {showForm && formTarget.targetId && (
        <ShareAccessSummary
          itemId={item.id}
          shareType={formTarget.shareType}
          selectedTargetId={formTarget.targetId}
          selectedTargetName={formTarget.targetName}
        />
      )}

      {/* Share list */}
      <ShareList
        shares={shares}
        orgShares={orgShares}
        loading={loading}
        error={error}
        editState={editingShare}
        deleteConfirm={deleteConfirm}
        onStartEdit={setEditingShare}
        onCancelEdit={() => setEditingShare(null)}
        onSaveEdit={handleSaveEdit}
        onRequestDelete={setDeleteConfirm}
        onCancelDelete={() => setDeleteConfirm(null)}
        onConfirmDelete={handleConfirmDelete}
      />
    </div>
  );
}
