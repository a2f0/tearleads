import type { ApiClient } from "@symcrypt/api-client";
import { resolveOrganizationBillingView } from "../../workflows/organizations/billing";
import { removeOrganizationProvisioningAttempt } from "../../workflows/organizations/organizationProvisioningAttempt";
import { clearRemoteSyncState } from "../../workflows/sync";
import type { Database } from "../database";
import type { Identity } from "../identity";
import { PurgedOrganizationRecoveryBillingRequiredError } from "./sessionRecoveryErrors";
import type {
  CreateOrganizationOptions,
  SessionContext,
  SessionCreateOrganizationResult,
  SessionRecoverOrganizationResult,
} from "./sessionTypes";

interface SessionPurgeRecoveryDependencies {
  api: Pick<ApiClient, "clearWriterProjectionCaches">;
  database: Pick<Database, "requireExecSql">;
  identity: Pick<Identity, "snapshot">;
  log: (message: string) => void;
}

interface SessionPurgeRecoveryContext {
  createOrganization: (
    options?: CreateOrganizationOptions,
    replacesOrganizationId?: string,
  ) => Promise<SessionCreateOrganizationResult | null>;
  organizationId: string | null;
  setContext: (context: SessionContext) => void;
  userId: string | null;
}

export async function clearSessionRemoteSyncState(
  dependencies: SessionPurgeRecoveryDependencies,
  session: SessionPurgeRecoveryContext,
  organizationId: string,
) {
  const execSql = dependencies.database.requireExecSql("clearRemoteSyncState");
  const result = await clearRemoteSyncState(execSql, {
    organizationId,
  });
  dependencies.api.clearWriterProjectionCaches();
  if (session.organizationId === organizationId) {
    session.setContext({ containerId: null, organizationId: null });
  }
  dependencies.log("Remote sync state cleared");
  return result;
}

export async function recoverPurgedSessionOrganization(
  dependencies: SessionPurgeRecoveryDependencies & {
    api: Pick<
      ApiClient,
      "clearWriterProjectionCaches" | "getOrganizationBilling"
    >;
  },
  session: SessionPurgeRecoveryContext,
  organizationId: string,
  options: CreateOrganizationOptions | undefined,
): Promise<SessionRecoverOrganizationResult | null> {
  const identitySnapshot = dependencies.identity.snapshot;
  const sessionOrganizationId = session.organizationId;
  const userId = session.userId;
  if (!userId) {
    throw new Error("Purged organization recovery requires a current user");
  }
  const isRecoveryCurrent = () =>
    dependencies.identity.snapshot === identitySnapshot &&
    session.organizationId === sessionOrganizationId &&
    session.userId === userId;
  const billing = await dependencies.api.getOrganizationBilling(organizationId);
  if (!billing || billing.status !== "purged") {
    throw new Error(
      `Organization ${organizationId} cannot be recovered before its purge finishes`,
    );
  }
  if (!isRecoveryCurrent()) return null;
  const replacement = await session.createOrganization(options, organizationId);
  if (!replacement) return null;
  if (!isRecoveryCurrent()) return null;
  const replacementBilling = await dependencies.api.getOrganizationBilling(
    replacement.organizationId,
  );
  if (!isRecoveryCurrent()) return null;
  if (!replacementBilling) {
    throw new Error("Replacement organization billing could not be loaded");
  }
  if (!resolveOrganizationBillingView(replacementBilling, Date.now()).canSync) {
    throw new PurgedOrganizationRecoveryBillingRequiredError(
      replacement.organizationId,
      replacementBilling.status,
    );
  }
  const execSql = dependencies.database.requireExecSql(
    "recoverPurgedOrganization",
  );
  const reset = await clearRemoteSyncState(
    execSql,
    {
      organizationId,
      replacement: {
        organizationId: replacement.organizationId,
        rootContainerId: replacement.containerId,
      },
    },
    isRecoveryCurrent,
  );
  if (!isRecoveryCurrent()) return null;
  const attemptRemoved = await removeOrganizationProvisioningAttempt({
    canCommit: isRecoveryCurrent,
    execSql,
    replacedOrganizationId: organizationId,
    userId,
  });
  if (!attemptRemoved || !isRecoveryCurrent()) return null;
  dependencies.api.clearWriterProjectionCaches();
  session.setContext({
    containerId: replacement.containerId,
    defaultOrganizationId: replacement.organizationId,
    organizationId: replacement.organizationId,
  });
  dependencies.log(
    `Purged organization replaced (${replacement.organizationId})`,
  );
  return {
    ...replacement,
    replacedOrganizationId: organizationId,
    reset,
  };
}
