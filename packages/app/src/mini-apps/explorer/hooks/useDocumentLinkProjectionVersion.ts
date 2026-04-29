import { useCallback, useState } from "react";

export function useDocumentLinkProjectionVersion() {
  const [documentLinkProjectionVersion, setDocumentLinkProjectionVersion] =
    useState(0);
  const handleDocumentLinksChanged = useCallback(() => {
    setDocumentLinkProjectionVersion((currentVersion) => currentVersion + 1);
  }, []);

  return {
    documentLinkProjectionVersion,
    handleDocumentLinksChanged,
  };
}
