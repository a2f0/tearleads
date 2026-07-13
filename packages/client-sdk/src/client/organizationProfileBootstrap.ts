import type { OrganizationBillingResponse } from "@tearleads/validators/response";
import { sqlDocumentsPersistence } from "../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import {
  loadOrganizationBilling,
  type OrganizationBilling,
  resolveOrganizationBillingView,
  startOrganizationTrial,
} from "../workflows/organizations";
import { getOrganizationProfileDocumentLocalId } from "../workflows/organizations/organizationProfile";
import { deriveOrganizationMetadataContainerSystemSlot } from "../workflows/organizations/rosterProfileContainer";
import type { ContainerContents } from "./containerContents";
import type { InternalRuntime } from "./workflowRuntime";

/**
 * Schedules a legacy locally-seeded organization profile body once billing
 * permits remote sync. Current provisioning commits the encrypted initial body
 * atomically with the document manifest, but databases created by older clients
 * can still carry this pending update across an upgrade.
 */
interface OrganizationProfileSyncInput {
  readonly billing: OrganizationBillingResponse;
  readonly containerContents: ContainerContents;
  readonly isRuntimeContextCurrent: () => boolean;
  readonly log: (message: string) => void;
}

export async function syncEntitledOrganizationProfile(
  input: OrganizationProfileSyncInput & { readonly execSql: ExecSql },
): Promise<boolean> {
  if (!resolveOrganizationBillingView(input.billing, Date.now()).canSync) {
    return false;
  }
  const organizationId = input.billing.organizationId;
  const pendingFingerprint = await loadPendingProfileUpdateFingerprint({
    execSql: input.execSql,
    organizationId,
  });
  if (pendingFingerprint === null) {
    return false;
  }
  return scheduleEntitledOrganizationProfile(input);
}

async function scheduleEntitledOrganizationProfile(
  input: OrganizationProfileSyncInput,
): Promise<boolean> {
  if (!resolveOrganizationBillingView(input.billing, Date.now()).canSync) {
    return false;
  }

  const organizationId = input.billing.organizationId;
  const localId = getOrganizationProfileDocumentLocalId({ organizationId });
  if (!input.isRuntimeContextCurrent()) {
    return false;
  }

  const systemSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId,
  });
  const tree = input.containerContents.openTree();
  const findMetadataContainer = () =>
    tree
      .getSnapshot()
      .nodes.find((candidate) => candidate.systemSlot === systemSlot);

  let metadataContainer = findMetadataContainer();
  if (!metadataContainer) {
    // The active organization normally has the locally-persisted bootstrap
    // node already. Refresh once for a cold tree; this path runs only after the
    // server has confirmed that the organization may sync.
    await tree.refresh();
    metadataContainer = findMetadataContainer();
  }
  if (!metadataContainer) {
    input.log(
      `Organizations: org metadata container not reachable for org ${organizationId}; skipped profile bootstrap sync`,
    );
    return false;
  }
  // Slot derivation and a cold-tree refresh are asynchronous. Re-check at the
  // last possible moment so a mid-flight org switch cannot open this alias with
  // another organization's current runtime/auth context.
  if (!input.isRuntimeContextCurrent()) {
    return false;
  }

  input.containerContents.pullDocumentContent({
    containerId: metadataContainer.id,
    localId,
  });
  return true;
}

async function loadPendingProfileUpdateFingerprint(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
}): Promise<string | null> {
  const localId = getOrganizationProfileDocumentLocalId(input);
  const localProfile = await sqlDocumentsPersistence.loadDocument(
    input.execSql,
    localId,
  );
  if (!localProfile) {
    return null;
  }
  const pendingUpdates = await sqlDocumentsPersistence.listPendingUpdates(
    input.execSql,
    localId,
  );
  return pendingUpdates.length > 0
    ? pendingUpdates.map((update) => update.id).join(":")
    : null;
}

export interface OrganizationProfileBootstrapCoordinator {
  loadBilling(): Promise<OrganizationBilling | null>;
  startTrial(): Promise<OrganizationBilling | null>;
}

/**
 * Observes the active organization's billing seam and flushes a legacy locally
 * seeded profile whenever billing is syncable and its deterministic local
 * alias still has pending updates. New provisioning has no pending profile
 * update; the persisted predicate keeps upgrade recovery working across reloads
 * and delayed purchase/restore activation.
 */
export function createOrganizationProfileBootstrapCoordinator(input: {
  readonly containerContents: ContainerContents;
  readonly runtimeService: InternalRuntime;
}): OrganizationProfileBootstrapCoordinator {
  return new OrganizationProfileBootstrapCoordinatorService(input);
}

class OrganizationProfileBootstrapCoordinatorService
  implements OrganizationProfileBootstrapCoordinator
{
  private readonly syncCheckInFlight = new Set<string>();
  private readonly syncRequestedFingerprintByOrganizationId = new Map<
    string,
    string
  >();

  constructor(
    private readonly input: {
      readonly containerContents: ContainerContents;
      readonly runtimeService: InternalRuntime;
    },
  ) {}

  async loadBilling(): Promise<OrganizationBilling | null> {
    const runtime = this.input.runtimeService.workflowInput();
    const organizationId = this.activeOrganizationId();
    if (!organizationId) {
      return null;
    }
    const billing = await loadOrganizationBilling({
      apiClient: runtime.apiClient,
      organizationId,
    });
    if (billing?.organizationId === organizationId) {
      this.scheduleProfileIfPending(billing);
    }
    return billing;
  }

  async startTrial(): Promise<OrganizationBilling | null> {
    const runtime = this.input.runtimeService.workflowInput();
    const organizationId = this.activeOrganizationId();
    if (!organizationId) {
      return null;
    }
    const billing = await startOrganizationTrial({
      apiClient: runtime.apiClient,
      organizationId,
    });
    if (billing?.organizationId === organizationId) {
      this.scheduleProfileIfPending(billing);
    }
    return billing;
  }

  private activeOrganizationId(): string | null {
    const { auth } = this.input.runtimeService.workflowInput();
    return auth.isAuthenticated ? auth.organizationId : null;
  }

  private scheduleProfileIfPending(billing: OrganizationBilling): void {
    const organizationId = billing.organizationId;
    const canSync = resolveOrganizationBillingView(billing, Date.now()).canSync;
    if (
      !canSync ||
      this.syncCheckInFlight.has(organizationId) ||
      this.activeOrganizationId() !== organizationId
    ) {
      return;
    }

    const runtime = this.input.runtimeService.workflowInput();
    if (runtime.infra.dbStatus !== "ready") {
      return;
    }
    const expectedContext = {
      domainScope: runtime.state.domainScope,
      execSql: runtime.infra.execSql,
      organizationId,
      userId: runtime.auth.userId,
    };
    const isRuntimeContextCurrent = () => {
      const current = this.input.runtimeService.workflowInput();
      return (
        current.auth.isAuthenticated &&
        current.auth.organizationId === expectedContext.organizationId &&
        current.auth.userId === expectedContext.userId &&
        current.infra.dbStatus === "ready" &&
        current.infra.execSql === expectedContext.execSql &&
        current.state.domainScope === expectedContext.domainScope
      );
    };

    this.syncCheckInFlight.add(organizationId);
    void loadPendingProfileUpdateFingerprint({
      execSql: runtime.infra.execSql,
      organizationId,
    })
      .then(async (pendingFingerprint) => {
        if (pendingFingerprint === null) {
          this.syncRequestedFingerprintByOrganizationId.delete(organizationId);
          return;
        }
        if (
          this.syncRequestedFingerprintByOrganizationId.get(organizationId) ===
          pendingFingerprint
        ) {
          return;
        }
        const scheduled = await scheduleEntitledOrganizationProfile({
          billing,
          containerContents: this.input.containerContents,
          isRuntimeContextCurrent,
          log: (message) => runtime.util.log(message),
        });
        if (scheduled) {
          this.syncRequestedFingerprintByOrganizationId.set(
            organizationId,
            pendingFingerprint,
          );
        }
      })
      .catch((error: unknown) => {
        // Billing already changed on the server. Never turn this best-effort
        // post-commit work into an apparent activation failure for the caller.
        runtime.util.log(
          `Organizations: best-effort profile bootstrap sync failed for org ${organizationId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        this.syncCheckInFlight.delete(organizationId);
      });
  }
}
