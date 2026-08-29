import type { ApiClient } from "@symcrypt/api-client";
import { clearRemoteSyncState } from "../../workflows/sync";
import type { Database } from "../database";
import type {
  CreateOrganizationOptions,
  SessionContext,
  SessionCreateOrganizationResult,
  SessionRecoverOrganizationResult,
} from "./sessionTypes";

interface SessionPurgeRecoveryDependencies {
  api: Pick<ApiClient, "clearWriterProjectionCaches">;
  database: Pick<Database, "requireExecSql">;
  log: (message: string) => void;
}

interface SessionPurgeRecoveryContext {
  createOrganization: (
    options?: CreateOrganizationOptions,
    replacesOrganizationId?: string,
  ) => Promise<SessionCreateOrganizationResult | null>;
  organizationId: string | null;
  setContext: (context: SessionContext) => void;
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
  const billing = await dependencies.api.getOrganizationBilling(organizationId);
  if (!billing || billing.status !== "purged") {
    throw new Error(
      `Organization ${organizationId} cannot be recovered before its purge finishes`,
    );
  }
  const replacement = await session.createOrganization(options, organizationId);
  if (!replacement) return null;
  const execSql = dependencies.database.requireExecSql(
    "recoverPurgedOrganization",
  );
  const reset = await clearRemoteSyncState(execSql, {
    organizationId,
    replacement: {
      organizationId: replacement.organizationId,
      rootContainerId: replacement.containerId,
    },
  });
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
