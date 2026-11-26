import type { DocumentHistory } from "@tearleads/client-sdk";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import type { DocumentHistoryVerificationState } from "../../../../stores/document-history/documentHistoryVerificationMachine";
import type { DocumentHistoryVerificationControls } from "../../../../stores/document-history/useDocumentHistoryVerification";
import { EXPLORER_LABELS } from "../../labels";

/** What the status line says about a check, and whether it is a warning. */
function describeVerification(state: DocumentHistoryVerificationState): {
  readonly text: string;
  readonly warning: boolean;
} {
  switch (state.status) {
    case "idle":
      return {
        text: EXPLORER_LABELS.documentHistoryVerifyUnchecked,
        warning: false,
      };
    case "checking":
      return {
        text: EXPLORER_LABELS.documentHistoryVerifyChecking(state.progress),
        warning: false,
      };
    case "verified": {
      const { serverAhead, voidUpdateCount } = state.report;
      return {
        text: [
          EXPLORER_LABELS.documentHistoryVerifyVerified,
          serverAhead ? EXPLORER_LABELS.documentHistoryVerifyServerAhead : null,
          voidUpdateCount > 0
            ? EXPLORER_LABELS.documentHistoryVerifyVoid(voidUpdateCount)
            : null,
        ]
          .filter((sentence) => sentence !== null)
          .join(" "),
        warning: false,
      };
    }
    case "mismatch":
      return {
        text: EXPLORER_LABELS.documentHistoryVerifyMismatch,
        warning: true,
      };
    case "unavailable":
      return {
        text: EXPLORER_LABELS.documentHistoryVerifyUnavailable[state.reason],
        // The one reason that says something is wrong, not merely missing.
        warning: state.reason === "rejected",
      };
    case "failed":
      return {
        text: EXPLORER_LABELS.documentHistoryVerifyFailed,
        warning: true,
      };
  }
}

function actionLabel(state: DocumentHistoryVerificationState): string {
  if (state.status === "idle" || state.status === "checking") {
    return EXPLORER_LABELS.documentHistoryVerifyAction;
  }
  return state.status === "failed"
    ? EXPLORER_LABELS.documentHistoryVerifyRetryAction
    : EXPLORER_LABELS.documentHistoryVerifyAgainAction;
}

/**
 * Whether the history on screen has been checked against the signed uploads
 * the server holds, with the action that checks it. The check only ever runs
 * when asked for. A mismatch offers the history rebuilt from the signed
 * uploads; while that is on screen the only action is the way back, since a
 * new check would close the replay being read.
 *
 * The status line is one live region for every state, so a change in what it
 * says is announced.
 */
export function DocumentHistoryVerification(params: {
  onShowLocal: () => void;
  onShowSigned: (signed: DocumentHistory) => void;
  /** Which history is on screen. */
  source: "local" | "signed";
  verification: DocumentHistoryVerificationControls;
}) {
  const { state, verify } = params.verification;
  const signedShown = params.source === "signed";
  const { text, warning } = signedShown
    ? {
        text: EXPLORER_LABELS.documentHistoryVerifySignedShown,
        warning: false,
      }
    : describeVerification(state);
  // A replay with no changes has nothing to show.
  const signed =
    !signedShown && state.status === "mismatch" && state.signed.stops.length > 0
      ? state.signed
      : null;

  return (
    <div className="explorer-document-history-verification">
      <MiniAppStatus
        as="span"
        role="status"
        title={state.status === "failed" ? state.message : undefined}
        tone={warning ? "error" : "muted"}
      >
        {text}
      </MiniAppStatus>
      {signed === null ? null : (
        <MiniAppButton onClick={() => params.onShowSigned(signed)}>
          {EXPLORER_LABELS.documentHistoryVerifyShowSignedAction}
        </MiniAppButton>
      )}
      {signedShown ? (
        <MiniAppButton onClick={params.onShowLocal}>
          {EXPLORER_LABELS.documentHistoryVerifyShowLocalAction}
        </MiniAppButton>
      ) : (
        <MiniAppButton loading={state.status === "checking"} onClick={verify}>
          {actionLabel(state)}
        </MiniAppButton>
      )}
    </div>
  );
}
