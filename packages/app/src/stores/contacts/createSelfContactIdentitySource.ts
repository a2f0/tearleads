import type { Tearleads } from "@tearleads/client-sdk";
import { loadCurrentSelfContactIdentity } from "./currentSelfContactIdentity";
import type { SelfContactIdentitySource } from "./currentSelfContactIdentityState";

export function createSelfContactIdentitySource(
  sdk: Tearleads,
  subscribeDiscovery: SelfContactIdentitySource["subscribe"],
): SelfContactIdentitySource {
  const version = sdk.runtime.version;
  const runtime = sdk.documents.workflowRuntime(null);
  const fingerprint = runtime.crypto.signingFingerprint ?? "";
  const execSql = runtime.infra.execSql;
  const enabled = runtime.infra.dbStatus === "ready" && !!fingerprint.trim();
  return {
    enabled,
    // A database or identity can leave and return to the same values. The
    // runtime generation prevents an earlier source from regaining authority.
    isCurrent: () => enabled && sdk.runtime.version === version,
    load: () => loadCurrentSelfContactIdentity(execSql, fingerprint),
    subscribe: (listener) => {
      const stopPersisted = sdk.documents.subscribe(listener, {
        containerId: null,
      });
      const stopDiscovery = subscribeDiscovery(listener);
      return () => {
        stopPersisted();
        stopDiscovery();
      };
    },
  };
}
