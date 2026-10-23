import { useState } from "react";
import { parseAuditSubject } from "./auditLabels";

/**
 * The audit filter input's draft. A full ID or an empty draft applies as the
 * subject; a partial one stays local with a hint. A subject chosen elsewhere
 * (a detail view's audit link, the section navigation) replaces a draft that
 * names a different subject, so the input always matches the listing.
 */
export function useAuditSubjectDraft(
  subjectId: string | null,
  onSubjectChange: (subjectId: string | null) => void,
) {
  const [draft, setDraft] = useState(subjectId ?? "");
  const [shownSubjectId, setShownSubjectId] = useState(subjectId);
  if (subjectId !== shownSubjectId) {
    setShownSubjectId(subjectId);
    if (parseAuditSubject(draft) !== subjectId) {
      setDraft(subjectId ?? "");
    }
  }
  const updateDraft = (value: string) => {
    setDraft(value);
    const parsed = parseAuditSubject(value);
    if (parsed !== undefined && parsed !== subjectId) {
      onSubjectChange(parsed);
    }
  };
  return {
    draft,
    draftIsIncomplete: parseAuditSubject(draft) === undefined,
    updateDraft,
  };
}
