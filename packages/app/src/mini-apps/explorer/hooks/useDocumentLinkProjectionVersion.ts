import { useCallback, useState } from "react";

export function useDocumentLinkProjectionVersion() {
  const [documentLinkProjectionVersion, setDocumentLinkProjectionVersion] =
    useState(0);
  const [
    documentLinkProjectionVersionByContainerId,
    setDocumentLinkProjectionVersionByContainerId,
  ] = useState<ReadonlyMap<string, number>>(() => new Map());

  // A link change bumps the global version AND a per-container version for each
  // affected container. The item table / detail pane only ever show the active
  // container, so they key off the global scalar. The sidebar shows containers
  // from EVERY org at once and its refresh blanks rows destructively, so it gates
  // that blank on the per-container version: a membership change in one org's
  // container must not blank another org's rows (the cross-org flicker).
  const handleDocumentLinksChanged = useCallback(
    (changedContainerIds?: Iterable<string>) => {
      setDocumentLinkProjectionVersion((version) => version + 1);
      setDocumentLinkProjectionVersionByContainerId((current) => {
        const next = new Map(current);
        if (changedContainerIds === undefined) {
          // The caller could not name the affected container(s): bump every known
          // container so the sidebar refreshes them all (the pre-clamp behavior).
          for (const containerId of next.keys()) {
            next.set(containerId, (next.get(containerId) ?? 0) + 1);
          }
        } else {
          for (const containerId of changedContainerIds) {
            next.set(containerId, (next.get(containerId) ?? 0) + 1);
          }
        }
        return next;
      });
    },
    [],
  );

  return {
    documentLinkProjectionVersion,
    documentLinkProjectionVersionByContainerId,
    handleDocumentLinksChanged,
  };
}
