import {
  ClassicApp,
  type ClassicState,
  type VfsLinkLikeRow
} from '@rapid/classic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { useDatabaseContext } from '@/db/hooks';
import {
  CLASSIC_EMPTY_STATE,
  loadClassicStateFromDatabase,
  persistClassicOrderToDatabase
} from '@/lib/classicPersistence';

export function ClassicWorkspace() {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const [initialState, setInitialState] =
    useState<ClassicState>(CLASSIC_EMPTY_STATE);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [stateRevision, setStateRevision] = useState(0);
  const fetchedForInstanceRef = useRef<string | null>(null);
  const linkRowsRef = useRef<VfsLinkLikeRow[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const fetchClassicState = useCallback(async () => {
    if (!isUnlocked) {
      return;
    }

    setWorkspaceLoading(true);
    setWorkspaceError(null);

    try {
      const { state, linkRows } = await loadClassicStateFromDatabase();
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
  }, [isUnlocked]);

  useEffect(() => {
    const needsFetch =
      isUnlocked &&
      !workspaceLoading &&
      fetchedForInstanceRef.current !== currentInstanceId;

    if (!needsFetch) {
      return;
    }

    fetchedForInstanceRef.current = currentInstanceId;
    fetchClassicState();
  }, [isUnlocked, workspaceLoading, currentInstanceId, fetchClassicState]);

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
          onStateChange={handleStateChange}
          contextMenuComponents={{ ContextMenu, ContextMenuItem }}
        />
      </div>
    </div>
  );
}
