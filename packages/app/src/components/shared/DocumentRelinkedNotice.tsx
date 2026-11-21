import { MiniAppButton } from "../mini-app/controls/MiniAppButton";
import { MiniAppStatus } from "../mini-app/controls/MiniAppStatus";

export const DOCUMENT_RELINKED_LABELS = {
  message:
    "This document now opens from a different copy. This view is read-only; its edits are kept and still sync.",
  reopen: "Reopen",
} as const;

/**
 * Shown while an open document view stays on its own record after another
 * pane relinked a record onto the same document. Reopen shows the document's
 * current copy.
 */
export function DocumentRelinkedNotice(params: { onReopen: () => void }) {
  return (
    <MiniAppStatus className="document-relinked-notice" role="status">
      {DOCUMENT_RELINKED_LABELS.message}{" "}
      <MiniAppButton onClick={params.onReopen}>
        {DOCUMENT_RELINKED_LABELS.reopen}
      </MiniAppButton>
    </MiniAppStatus>
  );
}
