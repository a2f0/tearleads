import type { StoredDocumentKind } from "@tearleads/client-sdk";
import { useCallback, useState } from "react";
import { createDocumentDraft } from "./documentDraft";

export function useDocumentDraft({
  containerId,
  documentKind,
  scope,
}: {
  containerId?: string | null | undefined;
  documentKind?: StoredDocumentKind | undefined;
  scope?: unknown;
} = {}) {
  const createState = () => ({
    scope,
    containerId,
    documentKind,
    draft: createDocumentDraft({ containerId, documentKind }),
  });
  const [stored, setStored] = useState(createState);
  let current = stored;
  // Draft identity is state, not a disposable memo. Rotate it when the owning
  // runtime or destination changes so a new identity cannot reuse the old ID.
  if (
    stored.scope !== scope ||
    stored.containerId !== containerId ||
    stored.documentKind !== documentKind
  ) {
    current = createState();
    setStored(current);
  }
  const resetDraft = useCallback(() => {
    const draft = createDocumentDraft({ containerId, documentKind });
    setStored({ scope, containerId, documentKind, draft });
    return draft;
  }, [containerId, documentKind, scope]);
  return { draft: current.draft, resetDraft };
}
