import type { VfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useVfsOrchestratorInstance } from './VfsOrchestratorContext';

const SNAPSHOT_POLL_INTERVAL_MS = 5000;

export interface VfsItemSyncCursor {
  changedAt: string;
  changeId: string;
}

interface VfsSyncStateSnapshot {
  globalCursor: VfsItemSyncCursor | null;
  cursorByItemId: ReadonlyMap<string, VfsItemSyncCursor>;
  updatedAtMs: number | null;
}

interface VfsSyncStateContextValue {
  globalCursor: VfsItemSyncCursor | null;
  getItemCursor: (itemId: string) => VfsItemSyncCursor | null;
  refresh: () => void;
  updatedAtMs: number | null;
}

const EMPTY_CURSOR_MAP: ReadonlyMap<string, VfsItemSyncCursor> = new Map();

const EMPTY_SNAPSHOT: VfsSyncStateSnapshot = {
  globalCursor: null,
  cursorByItemId: EMPTY_CURSOR_MAP,
  updatedAtMs: null
};

const EMPTY_CONTEXT_VALUE: VfsSyncStateContextValue = {
  globalCursor: null,
  getItemCursor: () => null,
  refresh: () => {},
  updatedAtMs: null
};

const VfsSyncStateContext = createContext<VfsSyncStateContextValue | null>(
  null
);

function normalizeRequiredString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cloneCursor(cursor: VfsSyncCursor): VfsItemSyncCursor {
  return {
    changedAt: cursor.changedAt,
    changeId: cursor.changeId
  };
}

function encodeSnapshotSignature(input: {
  globalCursor: VfsItemSyncCursor | null;
  containerClocks: Array<{
    containerId: string;
    changedAt: string;
    changeId: string;
  }>;
}): string {
  const globalCursorSignature = input.globalCursor
    ? `${input.globalCursor.changedAt}|${input.globalCursor.changeId}`
    : 'null';
  const containerClockSignature = input.containerClocks
    .map(
      (entry) =>
        `${entry.containerId}|${entry.changedAt}|${entry.changeId}`
    )
    .join(';');
  return `${globalCursorSignature}::${containerClockSignature}`;
}

function buildCursorMap(
  containerClocks: Array<{
    containerId: string;
    changedAt: string;
    changeId: string;
  }>
): ReadonlyMap<string, VfsItemSyncCursor> {
  const nextMap = new Map<string, VfsItemSyncCursor>();
  for (const clock of containerClocks) {
    const containerId = normalizeRequiredString(clock.containerId);
    if (!containerId) {
      continue;
    }
    nextMap.set(containerId, {
      changedAt: clock.changedAt,
      changeId: clock.changeId
    });
  }
  return nextMap;
}

export function VfsSyncStateProvider({ children }: { children: ReactNode }) {
  const orchestrator = useVfsOrchestratorInstance();
  const [snapshot, setSnapshot] = useState<VfsSyncStateSnapshot>(EMPTY_SNAPSHOT);
  const signatureRef = useRef<string>('null::');

  const refresh = useCallback(() => {
    if (!orchestrator) {
      if (signatureRef.current !== 'null::') {
        signatureRef.current = 'null::';
        setSnapshot(EMPTY_SNAPSHOT);
      }
      return;
    }

    const crdtSnapshot = orchestrator.crdt.snapshot();
    const globalCursor = crdtSnapshot.cursor
      ? cloneCursor(crdtSnapshot.cursor)
      : null;
    const signature = encodeSnapshotSignature({
      globalCursor,
      containerClocks: crdtSnapshot.containerClocks
    });

    if (signatureRef.current === signature) {
      return;
    }

    signatureRef.current = signature;
    setSnapshot({
      globalCursor,
      cursorByItemId: buildCursorMap(crdtSnapshot.containerClocks),
      updatedAtMs: Date.now()
    });
  }, [orchestrator]);

  useEffect(() => {
    refresh();
    if (!orchestrator) {
      return;
    }

    const timer = setInterval(() => {
      refresh();
    }, SNAPSHOT_POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [orchestrator, refresh]);

  const getItemCursor = useCallback(
    (itemId: string): VfsItemSyncCursor | null => {
      const normalizedItemId = normalizeRequiredString(itemId);
      if (!normalizedItemId) {
        return null;
      }
      const cursor = snapshot.cursorByItemId.get(normalizedItemId);
      return cursor ? { changedAt: cursor.changedAt, changeId: cursor.changeId } : null;
    },
    [snapshot.cursorByItemId]
  );

  const value = useMemo<VfsSyncStateContextValue>(
    () => ({
      globalCursor: snapshot.globalCursor,
      getItemCursor,
      refresh,
      updatedAtMs: snapshot.updatedAtMs
    }),
    [getItemCursor, refresh, snapshot.globalCursor, snapshot.updatedAtMs]
  );

  return (
    <VfsSyncStateContext.Provider value={value}>
      {children}
    </VfsSyncStateContext.Provider>
  );
}

export function useVfsSyncState(): VfsSyncStateContextValue {
  return useContext(VfsSyncStateContext) ?? EMPTY_CONTEXT_VALUE;
}

export function useVfsSyncCursor(
  itemId: string | null | undefined
): VfsItemSyncCursor | null {
  const { getItemCursor } = useVfsSyncState();
  if (typeof itemId !== 'string') {
    return null;
  }
  return getItemCursor(itemId);
}
