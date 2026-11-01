import type { Tearleads } from "@tearleads/client-sdk";
import { useEffect } from "react";
import type { AppDiagnostics } from "../../host/AppDiagnostics";

/**
 * Forward API requests that got no response to the host's diagnostics, which
 * reduce them to reviewed coarse fields and rate limit them. Without host
 * diagnostics (Sentry disabled, demo, development) nothing subscribes.
 */
export function useApiNetworkFailureDiagnostics(
  {
    subscribeApiNetworkFailures,
  }: Pick<Tearleads, "subscribeApiNetworkFailures">,
  diagnostics: AppDiagnostics | undefined,
): void {
  useEffect(() => {
    const report = diagnostics?.reportApiNetworkFailure;
    if (!report) {
      return;
    }
    return subscribeApiNetworkFailures((details) => report(details));
  }, [subscribeApiNetworkFailures, diagnostics]);
}
