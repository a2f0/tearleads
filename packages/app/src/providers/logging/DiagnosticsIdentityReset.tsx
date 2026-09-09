import { useEffect } from "react";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useIdentity } from "../identity/IdentityProvider";

// Identity is only a local reset signal. No identifier or key is passed to the
// adapter, and a new identity must not inherit the previous activity trail.
export function DiagnosticsIdentityReset() {
  const { diagnostics } = useAppHostConfig();
  const { signingFingerprint } = useIdentity();
  useEffect(() => {
    try {
      diagnostics?.clearBreadcrumbs?.();
    } catch {
      // Identity switching must remain usable if diagnostics are unavailable.
    }
  }, [diagnostics, signingFingerprint]);
  return null;
}
