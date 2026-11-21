import type {
  DocumentHistoryView,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { useEffect, useReducer, useRef } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  IDLE_DOCUMENT_HISTORY_COPY,
  transitionDocumentHistoryCopy,
} from "../../../../stores/document-history/documentHistoryCopyMachine";
import { EXPLORER_LABELS } from "../../labels";
import { DocumentHistoryConfirmation } from "./DocumentHistoryConfirmation";
import type { ExplorerDocumentVersionCopy } from "./useExplorerDocumentVersionCopy";

/**
 * Saves the version on screen as a new document in the same folder, after a
 * confirmation. The document being viewed is never written, so this does not
 * need it to be writable: it is offered whenever the folder takes a new
 * document of the version's kind, on the newest stop as well.
 */
export function DocumentHistoryCopy(params: {
  copy: ExplorerDocumentVersionCopy;
  documentSummary: DocumentSummary;
  index: number;
  /**
   * The user asked to copy this stop. The host holds the timeline here:
   * during playback the next tick would move to another stop and dismiss the
   * confirmation before it could be answered.
   */
  onRequested: () => void;
  versionTime: string;
  view: DocumentHistoryView;
}) {
  const { copy, documentSummary, index, onRequested, versionTime, view } =
    params;
  const [state, send] = useReducer(
    transitionDocumentHistoryCopy,
    IDLE_DOCUMENT_HISTORY_COPY,
  );
  const currentRun = useRef(0);
  // Set as soon as a copy starts, before the next render: a second submit in
  // the same tick must not create a second document.
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // `index` is the trigger: an outcome or a pending confirmation belongs to
  // the stop it was raised on.
  const shownIndex = useRef(index);
  useEffect(() => {
    if (shownIndex.current === index) return;
    shownIndex.current = index;
    send({ type: "stop-changed" });
  }, [index]);

  const offered = copy.canSave(documentSummary, view.documentKind);
  // A copy that was saved stays reachable even if the folder stops taking
  // new documents: it exists.
  if (!offered && state.status !== "saved" && state.status !== "saving") {
    return null;
  }

  const confirm = () => {
    if (saving.current) return;
    saving.current = true;
    currentRun.current += 1;
    const run = currentRun.current;
    send({ run, type: "confirmed" });
    const finish = (saved: DocumentSummary | null) => {
      saving.current = false;
      if (mounted.current) send({ copy: saved, run, type: "finished" });
    };
    copy.save(documentSummary, view).then(finish, () => finish(null));
  };

  return (
    <div className="explorer-document-history-copy">
      {offered || state.status === "saving" ? (
        <MiniAppButton
          disabled={!offered}
          loading={state.status === "saving"}
          onClick={() => {
            onRequested();
            send({ index, type: "requested" });
          }}
        >
          {EXPLORER_LABELS.documentHistoryCopyAction}
        </MiniAppButton>
      ) : null}
      {state.status === "saved" ? (
        <>
          <MiniAppStatus as="span" role="status">
            {EXPLORER_LABELS.documentHistoryCopySaved}
          </MiniAppStatus>
          <MiniAppButton onClick={() => copy.open(state.copy)}>
            {EXPLORER_LABELS.documentHistoryCopyOpenAction}
          </MiniAppButton>
        </>
      ) : null}
      {state.status === "refused" ? (
        <MiniAppStatus as="span" tone="error">
          {EXPLORER_LABELS.documentHistoryCopyRefused}
        </MiniAppStatus>
      ) : null}
      {state.status === "confirming" ? (
        <DocumentHistoryConfirmation
          cancelLabel={EXPLORER_LABELS.documentHistoryCopyCancel}
          confirmLabel={EXPLORER_LABELS.documentHistoryCopyConfirm}
          message={EXPLORER_LABELS.documentHistoryCopyMessage(versionTime)}
          onCancel={() => send({ type: "cancelled" })}
          onConfirm={confirm}
          title={EXPLORER_LABELS.documentHistoryCopyTitle}
        />
      ) : null}
    </div>
  );
}
