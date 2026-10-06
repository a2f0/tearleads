import type { Tearleads } from "@tearleads/client-sdk";
import { useEffect } from "react";
import type { AppDiagnostics } from "../../host/AppDiagnostics";

/**
 * Tag the host's error reports with the API build the SDK last heard from, so
 * a client failure can be read against the server deploy it happened under.
 */
export function useApiVersionDiagnostics(
  apiVersion: Tearleads["apiVersion"],
  diagnostics: AppDiagnostics | undefined,
): void {
  useEffect(() => {
    if (!diagnostics?.setApiVersion) {
      return;
    }
    const report = (version: number) => diagnostics.setApiVersion?.(version);
    if (apiVersion.current !== null) {
      report(apiVersion.current);
    }
    return apiVersion.subscribe(report);
  }, [apiVersion, diagnostics]);
}
