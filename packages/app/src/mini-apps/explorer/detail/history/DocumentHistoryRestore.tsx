import type { DocumentHistoryView } from "@tearleads/client-sdk";
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  IDLE_DOCUMENT_HISTORY_RESTORE,
  transitionDocumentHistoryRestore,
} from "../../../../stores/document-history/documentHistoryRestoreMachine";
import {
  DocumentWriteScopeContext,
  useDocument,
} from "../../../../stores/documents/DocumentsProvider";
import { EXPLORER_LABELS } from "../../labels";
import { DocumentHistoryConfirmation } from "./DocumentHistoryConfirmation";

/**
 * Restores the version on screen into the live document, after a
 * confirmation. It must render under the live document's provider: it offers
 * the restore only when that document can be written, and writes through it,
 * so the restore passes the same admission as any other edit.
 */
export function DocumentHistoryRestore(params: {
  index: number;
  /** The newest stop is the document as it is: there is nothing to restore. */
  isLatest: boolean;
  /**
   * The user asked to restore this stop. The host holds the timeline here:
   * during playback the next tick would move to another stop and dismiss the
   * confirmation before it could be answered.
   */
  onRequested: () => void;
  onRestored: () => void;
  /** When the version was made, as shown; null until it is known. */
  versionTime: string | null;
  view: DocumentHistoryView;
}) {
  const { index, isLatest, onRequested, onRestored, versionTime, view } =
    params;
  const { canWrite, ready, restoreContent } = useDocument();
  // Replaced when the database, account, or keys change. A restore confirmed
  // under one scope must not land under another.
  const writeScope = useContext(DocumentWriteScopeContext);
  const [state, send] = useReducer(
    transitionDocumentHistoryRestore,
    IDLE_DOCUMENT_HISTORY_RESTORE,
  );
  const currentRun = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // What a queued restore is admitted against when it reaches the front of
  // the write queue. Updated before paint, so a suspended render cannot
  // revoke the authority of the control still on screen.
  const admission = useRef({ canWrite, writeScope });
  useLayoutEffect(() => {
    admission.current = { canWrite, writeScope };
  }, [canWrite, writeScope]);
  // `index` is the trigger: a refusal or a pending confirmation belongs to
  // the stop it was raised on.
  const shownIndex = useRef(index);
  useEffect(() => {
    if (shownIndex.current === index) return;
    shownIndex.current = index;
    send({ type: "stop-changed" });
  }, [index]);

  if (!ready || !canWrite || isLatest) {
    return null;
  }

  const confirm = () => {
    currentRun.current += 1;
    const run = currentRun.current;
    send({ run, type: "confirmed" });
    const confirmedScope = writeScope;
    restoreContent(view, {
      // The write waits behind others. By the time it runs, the user may have
      // left, the document may have become read-only (moved to the Trash), or
      // the database, account, or keys may have changed: none may land it.
      stillCurrent: () =>
        mounted.current &&
        currentRun.current === run &&
        admission.current.canWrite &&
        admission.current.writeScope === confirmedScope,
    }).then(
      (restored) => {
        if (!mounted.current) return;
        send({ restored, run, type: "finished" });
        if (restored) onRestored();
      },
      () => {
        if (mounted.current) send({ restored: false, run, type: "finished" });
      },
    );
  };

  return (
    <div className="explorer-document-history-restore">
      <MiniAppButton
        loading={state.status === "restoring"}
        onClick={() => {
          onRequested();
          send({ index, type: "requested" });
        }}
      >
        {EXPLORER_LABELS.documentHistoryRestoreAction}
      </MiniAppButton>
      {state.status === "refused" ? (
        <MiniAppStatus as="span" tone="error">
          {EXPLORER_LABELS.documentHistoryRestoreRefused}
        </MiniAppStatus>
      ) : null}
      {state.status === "confirming" ? (
        <DocumentHistoryConfirmation
          cancelLabel={EXPLORER_LABELS.documentHistoryRestoreCancel}
          confirmLabel={EXPLORER_LABELS.documentHistoryRestoreConfirm}
          message={EXPLORER_LABELS.documentHistoryRestoreMessage(versionTime)}
          onCancel={() => send({ type: "cancelled" })}
          onConfirm={confirm}
          title={EXPLORER_LABELS.documentHistoryRestoreTitle}
        />
      ) : null}
    </div>
  );
}
