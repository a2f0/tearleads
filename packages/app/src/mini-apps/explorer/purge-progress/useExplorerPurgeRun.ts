import type { PurgeOptions, PurgeProgress } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { EXPLORER_LABELS, getExplorerPurgeContainerTitle } from "../labels";

export type ExplorerPurgeRunKind = "container" | "empty-trash";

// A purge run moves through exactly one of these terminal states after "running":
// done (everything destroyed), cancelled (user stopped it mid-way — a consistent
// prefix was destroyed), or failed (offline, or some items could not be deleted).
export type ExplorerPurgeRunStatus =
  | "running"
  | "done"
  | "cancelled"
  | "failed";

export interface ExplorerPurgeRunState {
  error: string | null;
  kind: ExplorerPurgeRunKind;
  progress: PurgeProgress | null;
  status: ExplorerPurgeRunStatus;
  title: string;
}

export interface ExplorerPurgeRun {
  cancel: () => void;
  dismiss: () => void;
  run: ExplorerPurgeRunState | null;
  startContainerPurge: (containerId: string, name: string) => void;
  startEmptyTrash: (trashContainerId: string) => void;
}

interface UseExplorerPurgeRunParams {
  emptyTrash: (
    trashContainerId: string,
    options?: PurgeOptions,
  ) => Promise<boolean>;
  logError: (message: string | Error, cause?: unknown) => void;
  online: boolean;
  // Called once a run settles (done/cancelled/failed) so the open container
  // listing re-queries SQLite and drops destroyed rows — the recursive purge only
  // bumps the sidebar tree snapshot, not the document list.
  onSettled: () => void;
  purgeContainer: (
    containerId: string,
    options?: PurgeOptions,
  ) => Promise<boolean>;
}

// A fresh progress object each tick, applied only while still running so a late
// callback can't overwrite an already-terminal state.
function purgeRunWithProgress(
  current: ExplorerPurgeRunState | null,
  progress: PurgeProgress,
): ExplorerPurgeRunState | null {
  return current && current.status === "running"
    ? { ...current, progress }
    : current;
}

// Resolve the terminal state once the invoke promise settles: a user-cancelled
// run is "cancelled"; a clean run with no failed items is "done"; anything else
// (partial failure, thrown error) is "failed".
function settledPurgeRun(
  current: ExplorerPurgeRunState | null,
  input: { aborted: boolean; succeeded: boolean },
): ExplorerPurgeRunState | null {
  if (!current) {
    return current;
  }
  if (input.aborted) {
    return { ...current, error: null, status: "cancelled" };
  }
  const failedCount = current.progress?.failedCount ?? 0;
  if (input.succeeded && failedCount === 0) {
    return { ...current, error: null, status: "done" };
  }
  return {
    ...current,
    error: EXPLORER_LABELS.purgeProgressPartialFailure,
    status: "failed",
  };
}

interface PurgeRunStartInput {
  invoke: (options: PurgeOptions) => Promise<boolean>;
  kind: ExplorerPurgeRunKind;
  title: string;
}

// Owns the lifecycle of a long-running "Delete Forever" / "Empty Trash" purge:
// the live progress, the AbortController for cancellation, and the terminal
// status the progress modal renders. Kept separate from the confirm-modal state
// machine (which is a synchronous form) so the modal can stay mounted showing a
// determinate bar while the detached purge runs.
export function useExplorerPurgeRun(
  params: UseExplorerPurgeRunParams,
): ExplorerPurgeRun {
  const { emptyTrash, logError, online, onSettled, purgeContainer } = params;
  const [run, setRun] = useState<ExplorerPurgeRunState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  // Abort any in-flight purge on unmount so it can't run orphaned with no UI.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(
    (input: PurgeRunStartInput) => {
      // One purge at a time: the store already serializes writes, but the modal
      // is single-slot, so a second start while one runs is ignored.
      if (runningRef.current) {
        return;
      }
      // Permanent deletion is online-only (there is no offline purge outbox).
      // Surface it as a failed run with a clear reason rather than silently
      // doing nothing.
      if (!online) {
        setRun({
          error: EXPLORER_LABELS.purgeProgressOfflineError,
          kind: input.kind,
          progress: null,
          status: "failed",
          title: input.title,
        });
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      runningRef.current = true;
      setRun({
        error: null,
        kind: input.kind,
        progress: null,
        status: "running",
        title: input.title,
      });

      void input
        .invoke({
          onProgress: (progress) => {
            setRun((current) => purgeRunWithProgress(current, progress));
          },
          signal: controller.signal,
        })
        .then((succeeded) => {
          setRun((current) =>
            settledPurgeRun(current, {
              aborted: controller.signal.aborted,
              succeeded,
            }),
          );
        })
        .catch((error: unknown) => {
          // A user-initiated Stop can surface as an AbortError rejection rather
          // than a clean resolve (aborted fetches / DB transactions reject).
          // Classify that as cancelled, not failed, and skip the error log so a
          // normal cancel isn't reported as a failure.
          const aborted = controller.signal.aborted;
          if (!aborted) {
            logError("Explorer purge run failed", error);
          }
          setRun((current) =>
            settledPurgeRun(current, { aborted, succeeded: false }),
          );
        })
        .finally(() => {
          runningRef.current = false;
          abortRef.current = null;
          onSettled();
        });
    },
    [logError, online, onSettled],
  );

  const startContainerPurge = useCallback(
    (containerId: string, name: string) => {
      start({
        invoke: (options) => purgeContainer(containerId, options),
        kind: "container",
        title: getExplorerPurgeContainerTitle(name),
      });
    },
    [purgeContainer, start],
  );

  const startEmptyTrash = useCallback(
    (trashContainerId: string) => {
      start({
        invoke: (options) => emptyTrash(trashContainerId, options),
        kind: "empty-trash",
        title: EXPLORER_LABELS.emptyTrashProgressTitle,
      });
    },
    [emptyTrash, start],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const dismiss = useCallback(() => {
    // Never tear down the modal mid-flight — the Stop button (cancel) is the only
    // affordance while running.
    if (runningRef.current) {
      return;
    }
    setRun(null);
  }, []);

  return { cancel, dismiss, run, startContainerPurge, startEmptyTrash };
}
