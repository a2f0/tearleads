import { useCallback, useState } from "react";

export function useDocumentLinkProjectionVersion() {
  const [documentLinkProjectionVersion, setDocumentLinkProjectionVersion] =
    useState(0);
  const handleDocumentLinksChanged = useCallback(() => {
    setDocumentLinkProjectionVersion((version) => version + 1);
  }, []);
  return { documentLinkProjectionVersion, handleDocumentLinksChanged };
}
