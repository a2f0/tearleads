import type {
  DocumentHistoryView,
  DocumentSummary,
} from "@tearleads/client-sdk";
import {
  type Dispatch,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  type DocumentHistoryCopyEvent,
  type DocumentHistoryCopyState,
  IDLE_DOCUMENT_HISTORY_COPY,
  transitionDocumentHistoryCopy,
} from "../../../../stores/document-history/documentHistoryCopyMachine";
import { EXPLORER_LABELS } from "../../labels";
import { DocumentHistoryConfirmation } from "./DocumentHistoryConfirmation";
import type { ExplorerDocumentVersionCopy } from "./useExplorerDocumentVersionCopy";

/** A copy's progress, and the one way to start creating it. */
export interface DocumentHistoryCopyControl {
  /** Create the copy the user confirmed; a copy already in flight wins. */
  confirm: (document: DocumentSummary, view: DocumentHistoryView) => void;
  send: Dispatch<DocumentHistoryCopyEvent>;
  state: DocumentHistoryCopyState;
}

/**
 * Holds a copy's progress for as long as a document's History is open. The
 * timeline's actions come and go as stops replay and as History reloads, and
 * a copy outlives them: once confirmed its document exists, so its outcome
 * must still be reported, or the user would save it a second time.
 */
export function useDocumentHistoryCopyControl(
  copy: ExplorerDocumentVersionCopy,
): DocumentHistoryCopyControl {
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

  // A copy asked for, in flight, or reported under one database or account
  // is not another's to show: forget it when the scope changes.
  const { scope } = copy;
  const heldScope = useRef(scope);
  useEffect(() => {
    if (heldScope.current === scope) return;
    heldScope.current = scope;
    saving.current = false;
    send({ type: "scope-changed" });
  }, [scope]);

  const { status } = state;
  const confirm = useCallback<DocumentHistoryCopyControl["confirm"]>(
    (document, view) => {
      // Only a confirmation that is open starts a copy: otherwise the machine
      // would ignore `confirmed` and the document's outcome would go unsaid.
      if (saving.current || status !== "confirming") return;
      saving.current = true;
      currentRun.current += 1;
      const run = currentRun.current;
      send({ run, type: "confirmed" });
      const finish = (saved: DocumentSummary | null) => {
        // A copy from before a scope change must not release a later one.
        if (currentRun.current === run) saving.current = false;
        if (mounted.current) send({ copy: saved, run, type: "finished" });
      };
      let pending: Promise<DocumentSummary | null>;
      try {
        pending = copy.save(document, view);
      } catch {
        pending = Promise.resolve(null);
      }
      pending.then(finish, () => finish(null));
    },
    [copy, status],
  );

  return useMemo(() => ({ confirm, send, state }), [confirm, state]);
}

/**
 * Saves the version on screen as a new document in the same folder, after a
 * confirmation. The document being viewed is never written, so this does not
 * need it to be writable: it is offered whenever the folder takes a new
 * document of the version's kind, on the newest stop as well.
 */
export function DocumentHistoryCopy(params: {
  control: DocumentHistoryCopyControl;
  copy: ExplorerDocumentVersionCopy;
  documentSummary: DocumentSummary;
  /** The selected stop. */
  index: number;
  /**
   * The user asked to copy this stop. The host holds the timeline here:
   * during playback the next tick would move to another stop and dismiss the
   * confirmation before it could be answered.
   */
  onRequested: () => void;
  /**
   * When the version was made, as shown; null until it is known. A
   * confirmation names the time shown when it was asked for, so its text does
   * not change while it is read.
   */
  versionTime: string | null;
  /** The selected stop's version, or null while it replays. */
  view: DocumentHistoryView | null;
}) {
  const { control, copy, documentSummary, index, onRequested, versionTime } =
    params;
  const { view } = params;
  const { send, state } = control;
  // Tell the machine which stop this shows, and when it stops showing one
  // (the timeline unmounts while History reloads): it drops what was raised
  // on another stop, and holds an outcome that arrives with no stop on screen
  // for the next one shown.
  useEffect(() => {
    send({ index, type: "stop-shown" });
    return () => send({ index: null, type: "stop-shown" });
  }, [index, send]);

  const offered = view !== null && copy.canSave(documentSummary, view);
  // The folder was trashed or lost write access, or Me stopped being known,
  // while the confirmation was open: refuse it where the user can see why,
  // rather than drop the dialog and bring it back if the offer returns. A
  // stop that is only replaying has withdrawn nothing.
  const withdrawn = view !== null && !offered;
  useEffect(() => {
    if (withdrawn) send({ type: "withdrawn" });
  }, [withdrawn, send]);

  const inFlight = state.status === "saving";
  // A copy that was saved stays reachable even if the folder stops taking
  // new documents, and a refusal stays readable: both describe what happened.
  if (
    !offered &&
    !inFlight &&
    state.status !== "saved" &&
    state.status !== "refused"
  ) {
    return null;
  }

  return (
    <div className="explorer-document-history-copy">
      {offered || inFlight ? (
        <MiniAppButton
          disabled={!offered}
          loading={inFlight}
          onClick={() => {
            onRequested();
            send({ index, type: "requested", versionTime });
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
        <MiniAppStatus as="span" role="alert" tone="error">
          {EXPLORER_LABELS.documentHistoryCopyRefused}
        </MiniAppStatus>
      ) : null}
      {state.status === "confirming" &&
      state.index === index &&
      offered &&
      view !== null ? (
        <DocumentHistoryConfirmation
          cancelLabel={EXPLORER_LABELS.documentHistoryCopyCancel}
          confirmLabel={EXPLORER_LABELS.documentHistoryCopyConfirm}
          message={EXPLORER_LABELS.documentHistoryCopyMessage(
            state.versionTime,
          )}
          onCancel={() => send({ type: "cancelled" })}
          onConfirm={() => control.confirm(documentSummary, view)}
          title={EXPLORER_LABELS.documentHistoryCopyTitle}
        />
      ) : null}
    </div>
  );
}
