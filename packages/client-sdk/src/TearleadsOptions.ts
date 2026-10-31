import type { ApiRequestMetrics } from "@tearleads/api-client";
import type { BlobStoreFactory } from "./client/blobs";
import type { Logger } from "./client/host/logger";
import type { IdentityOptions } from "./client/identity";
import type { DatabaseOptions } from "./client/runtime/database";
import type { PrincipalHistoryKeyProvider } from "./client/runtime/principalHistoryProtection";
import type { SecurityIncidentListener } from "./client/securityIncidents";
import type { BlobStore } from "./data/blobs/blobContracts";
import type { DocumentProjectorRegistryInput } from "./data/documents/documentKinds";
import type { ProvisionedSystemContainerSpec } from "./workflows/registration";

export type TearleadsDatabaseOptions = Omit<DatabaseOptions, "status">;

/** What a host passes to `new Tearleads(options)`; every field is optional. */
export interface TearleadsOptions {
  apiBaseUrl?: string | undefined;
  /** Reuse a memory-only request counter across client lifetimes. */
  apiRequestMetrics?: ApiRequestMetrics | undefined;
  blobStore?: BlobStore | undefined;
  blobStoreFactory?: BlobStoreFactory | undefined;
  database?: TearleadsDatabaseOptions | undefined;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
  events?: ReadonlyArray<unknown> | undefined;
  identity?: IdentityOptions | undefined;
  /**
   * Absolute, host-controlled API namespace for durable user-identity pins.
   * Required only when apiBaseUrl is relative and no browser origin exists.
   */
  identityTrustDomain?: string | undefined;
  identityProvisioning?: "auto" | "manual" | undefined;
  logger?: Logger | undefined;
  online?: boolean | undefined;
  /** Called after a trust-boundary verification failure is durably recorded. */
  onSecurityIncident?: SecurityIncidentListener | undefined;
  /**
   * Per-pane discriminator so documents in distinct panes derive distinct Loro
   * peer ids (e.g. the pane's local identity namespace). Omit for single-pane.
   */
  peerScope?: string | undefined;
  /**
   * After a request fails without a response, probe the API origin (one
   * rate-limited `no-cors` HEAD) to tell an unreachable host from a CORS or
   * blocked call. Browser shells enable it; tests and servers leave it off.
   */
  probeApiNetworkFailures?: boolean | undefined;
  /** Private host key for durable history progress; omitted uses disposable session keys. */
  principalHistoryKeyProvider?: PrincipalHistoryKeyProvider | undefined;
  /** Compound policy dispatch/recovery deadline in milliseconds; defaults to 60 seconds. */
  principalMutationTimeoutMs?: number | undefined;
  /**
   * App-owned system containers born with every new organization (both
   * registration and additional-org creation provision them atomically in the
   * same server call), e.g. a trash bin. The app owns these because their slot
   * namespaces are app concepts the SDK stays agnostic to.
   */
  provisionedSystemContainers?:
    | ReadonlyArray<ProvisionedSystemContainerSpec>
    | undefined;
}
