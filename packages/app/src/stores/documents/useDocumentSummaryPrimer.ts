import type { DocumentSummary } from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { primeDocumentSummaries } from "./primeDocumentSummaries";

/** Visible rows need decrypted titles even when their editor stays closed. */
export function useDocumentSummaryPrimer(): (
  summaries: ReadonlyArray<DocumentSummary>,
) => void {
  const tearleads = useTearleads();
  const runtime = useTearleadsRuntime();
  return useCallback(
    (summaries: ReadonlyArray<DocumentSummary>) => {
      const isCurrent = () => {
        const current = tearleads.runtime.input();
        return (
          current.infra.dbStatus === "ready" &&
          current.infra.execSql === runtime.infra.execSql &&
          current.state.domainScope === runtime.state.domainScope &&
          current.auth.organizationId === runtime.auth.organizationId &&
          current.auth.userId === runtime.auth.userId
        );
      };
      if (!isCurrent()) return;
      primeDocumentSummaries({
        documentLinks: tearleads.containerContents.documentLinks(),
        isCurrent,
        summaries,
      });
    },
    [runtime, tearleads],
  );
}
