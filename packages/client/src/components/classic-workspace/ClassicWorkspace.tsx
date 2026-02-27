import {
  ClassicApp,
  type ClassicState,
  type EntrySortOrder,
  type TagSortOrder,
  type VfsLinkLikeRow
} from '@tearleads/classic';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useOrg } from '@/contexts/OrgContext';
import { useDatabaseContext } from '@/db/hooks';
import {
  CLASSIC_EMPTY_STATE,
  createClassicNote,
  createClassicTag,
  deleteClassicTag,
  loadClassicStateFromDatabase,
  persistClassicOrderToDatabase,
  renameClassicTag,
  restoreClassicTag,
  updateClassicNote
} from '@/lib/classicPersistence';

interface ClassicWorkspaceProps {
  tagSortOrder?: TagSortOrder | undefined;
  entrySortOrder?: EntrySortOrder | undefined;
  onTagSortOrderChange?: ((nextSortOrder: TagSortOrder) => void) | undefined;
  onEntrySortOrderChange?:
    | ((nextSortOrder: EntrySortOrder) => void)
    | undefined;
}

export function ClassicWorkspace({
  tagSortOrder,
  entrySortOrder,
  onTagSortOrderChange,
  onEntrySortOrderChange
}: ClassicWorkspaceProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { activeOrganizationId } = useOrg();
  const [initialState, setInitialState] =
    useState<ClassicState>(CLASSIC_EMPTY_STATE);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [stateRevision, setStateRevision] = useState(0);
  const fetchedForInstanceRef = useRef<string | null>(null);
  const fetchedForOrgRef = useRef<string | null>(null);
  const linkRowsRef = useRef<VfsLinkLikeRow[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const isSortControlledExternally =
    tagSortOrder !== undefined &&
    entrySortOrder !== undefined &&
    onTagSortOrderChange !== undefined &&
    onEntrySortOrderChange !== undefined;

  const fetchClassicState = useCallback(async () => {
    if (!isUnlocked) {
      return;
    }

    setWorkspaceLoading(true);
    setWorkspaceError(null);

    try {
      const { state, linkRows } =
        await loadClassicStateFromDatabase(activeOrganizationId);
      setInitialState(state);
      linkRowsRef.current = linkRows;
      setStateRevision((current) => current + 1);
    } catch (err) {
      console.error('Failed to load classic state:', err);
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setInitialState(CLASSIC_EMPTY_STATE);
      linkRowsRef.current = [];
      setStateRevision((current) => current + 1);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [isUnlocked, activeOrganizationId]);

  useEffect(() => {
    const instanceChanged = fetchedForInstanceRef.current !== currentInstanceId;
    const orgChanged = fetchedForOrgRef.current !== activeOrganizationId;
    const needsFetch =
      isUnlocked && !workspaceLoading && (instanceChanged || orgChanged);

    if (!needsFetch) {
      return;
    }

    fetchedForInstanceRef.current = currentInstanceId;
    fetchedForOrgRef.current = activeOrganizationId;
    fetchClassicState();
  }, [
    isUnlocked,
    workspaceLoading,
    currentInstanceId,
    activeOrganizationId,
    fetchClassicState
  ]);

  const handleStateChange = useCallback((nextState: ClassicState) => {
    saveQueueRef.current = saveQueueRef.current
      .then(async () => {
        const updatedLinkRows = await persistClassicOrderToDatabase(
          nextState,
          linkRowsRef.current
        );
        linkRowsRef.current = updatedLinkRows;
        setWorkspaceError(null);
      })
      .catch((err) => {
        console.error('Failed to persist classic ordering:', err);
        setWorkspaceError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center rounded border p-4 text-muted-foreground text-sm">
        Loading database...
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <InlineUnlock description="classic data" />
      </div>
    );
  }

  if (workspaceLoading) {
    return (
      <div className="flex h-full items-center justify-center rounded border p-4 text-muted-foreground text-sm">
        Loading classic data...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {workspaceError && (
        <div className="rounded border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          Failed to sync Classic state: {workspaceError}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ClassicApp
          key={`${currentInstanceId ?? 'default'}-${stateRevision}`}
          initialState={initialState}
          autoFocusSearch
          {...(isSortControlledExternally && {
            tagSortOrder,
            entrySortOrder,
            onTagSortOrderChange,
            onEntrySortOrderChange,
            showSortControls: false
          })}
          onStateChange={handleStateChange}
          onCreateTag={async (tagId, name) => {
            await createClassicTag(name, tagId, activeOrganizationId);
          }}
          onDeleteTag={async (tagId) => {
            await deleteClassicTag(tagId);
            await fetchClassicState();
          }}
          onRestoreTag={async (tagId) => {
            await restoreClassicTag(tagId);
            await fetchClassicState();
          }}
          onRenameTag={async (tagId, newName) => {
            await renameClassicTag(tagId, newName);
          }}
          onCreateNote={async (noteId, tagId, title, body) => {
            await createClassicNote(
              tagId,
              title,
              body,
              noteId,
              activeOrganizationId
            );
          }}
          onUpdateNote={async (noteId, title, body) => {
            await updateClassicNote(noteId, title, body);
          }}
          contextMenuComponents={{ ContextMenu, ContextMenuItem }}
        />
      </div>
    </div>
  );
}
