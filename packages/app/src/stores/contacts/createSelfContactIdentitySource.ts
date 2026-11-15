import type { LocalProjectionView, Tearleads } from "@tearleads/client-sdk";
import { isDocumentsAuthorityCurrent } from "../documents/documentsAuthority";
import { loadCurrentSelfContactIdentity } from "./currentSelfContactIdentity";
import type { SelfContactIdentitySource } from "./currentSelfContactIdentityState";
import { subscribeToSelfContactIdentityDiscovery } from "./selfContactIdentityDiscovery";

/** `authority` is the documents authority generation the caller rendered
 * under; the source refuses once it changes, including after A -> B -> A. */
export function createSelfContactIdentitySource(
  sdk: Tearleads,
  view: Pick<LocalProjectionView, "getSnapshot" | "subscribe">,
  authority: number,
): SelfContactIdentitySource {
  const runtime = sdk.documents.workflowRuntime(null);
  const fingerprint = runtime.crypto.signingFingerprint ?? "";
  const execSql = runtime.infra.execSql;
  const enabled = runtime.infra.dbStatus === "ready" && !!fingerprint.trim();
  return {
    enabled,
    isCurrent: () => enabled && isDocumentsAuthorityCurrent(sdk, authority),
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
