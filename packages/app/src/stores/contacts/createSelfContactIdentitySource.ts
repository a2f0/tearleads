import type { LocalProjectionView, Tearleads } from "@tearleads/client-sdk";
import { loadCurrentSelfContactIdentity } from "./currentSelfContactIdentity";
import type { SelfContactIdentitySource } from "./currentSelfContactIdentityState";
import { subscribeToSelfContactIdentityDiscovery } from "./selfContactIdentityDiscovery";

export function createSelfContactIdentitySource(
  sdk: Tearleads,
  view: Pick<LocalProjectionView, "getSnapshot" | "subscribe">,
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
      let active = true;
      const notify = () => {
        if (active) listener();
      };
      const stopPersisted = sdk.documents.subscribe(
        (_document, change) => {
          // Births, placement changes and relinks can change identity;
          // content-only autosaves cannot. Do not filter by kind or folder.
          if (change.placementChanged) notify();
        },
        { containerId: null },
      );
      const stopDiscovery = subscribeToSelfContactIdentityDiscovery(
        view,
        notify,
      );
      return () => {
        active = false;
        stopPersisted();
        stopDiscovery();
      };
    },
  };
}
