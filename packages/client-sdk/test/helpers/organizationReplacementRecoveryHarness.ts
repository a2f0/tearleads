import type { ApiClient } from "@tearleads/api-client";
import type { SigningKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import type {
  CreateOrganizationResponse,
  OrganizationBillingResponse,
} from "@tearleads/validators/response";
import { Database } from "../../src/client/database";
import { createIdentity } from "../../src/client/identity";
import { createSession } from "../../src/client/session";
import {
  accessManifestCheckpoints,
  clientSqlTables,
  containers,
  principalPolicyCheckpoints,
  principalPolicyOrganizations,
} from "../../src/data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../src/data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../src/data/sqlite/sqlTableSchema";
import { createSqlClient, setGeneratedIdentity } from "./clientTestSupport";
import { respondToOrganizationProvisioning } from "./organizationProvisioningResponder";

function billing(
  organizationId: string,
  userId: string,
  active: boolean,
): OrganizationBillingResponse {
  return {
    organizationId,
    activeMemberCount: 1,
    assignedSeatCount: active ? 1 : 0,
    assignedUserIds: active ? [userId] : [],
    currentUserHasSyncSeat: active,
    currentPeriodEndsAt: active ? "2099-01-01T00:00:00.000Z" : null,
    currentPeriodStartsAt: active ? "2026-09-28T00:00:00.000Z" : null,
    disabledAt: null,
    pendingSeatCount: null,
    provider: null,
    purgeAfter: null,
    canCancelDirectly: false,
    subscriptionSource: null,
    seatCount: active ? 1 : 0,
    status: active ? "active" : "purged",
    trialEndsAt: null,
  };
}

export async function createOrganizationReplacementRecoveryHarness(
  respond: (input: {
    request: CreateOrganizationRequest;
    response: CreateOrganizationResponse;
    signingKeyPair: SigningKeyPair;
  }) => CreateOrganizationResponse | Promise<CreateOrganizationResponse>,
) {
  const { close, execSql } = await createTestExecSql("authenticated-recovery");
  const oldOrganizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const rootId = crypto.randomUUID();
  const identity = createIdentity(
    {},
    () => {},
    () => {},
  );
  await setGeneratedIdentity(identity);
  const signingKeyPair = identity.snapshot.signingKeyPair;
  if (!signingKeyPair) throw new Error("Expected signing identity");
  const requests: CreateOrganizationRequest[] = [];
  let clearCount = 0;
  const api = {
    createOrganization: async (request: CreateOrganizationRequest) => {
      requests.push(request);
      return respond({
        request,
        response: await respondToOrganizationProvisioning(request),
        signingKeyPair,
      });
    },
    clearWriterProjectionCaches: () => {
      clearCount++;
    },
    getOrganizationBilling: async (organizationId: string) =>
      billing(organizationId, userId, organizationId !== oldOrganizationId),
    getAuthToken: () => null,
    setAuthToken: () => {},
  } as unknown as ApiClient;
  const session = createSession({
    api,
    database: new Database({ client: createSqlClient(execSql) }),
    identity,
    log: () => {},
    logError: () => {},
    onUserIdentityAvailable: async () => {},
  });
  await ensureSqlTables(execSql, clientSqlTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const updatedAt = "2026-09-28T00:00:00.000Z";
  await db.insert(containers).values({
    id: rootId,
    organizationId: oldOrganizationId,
    parentId: null,
    metadataDocumentId: crypto.randomUUID(),
    systemSlot: "root",
    localCreatedAt: updatedAt,
    localUpdatedAt: updatedAt,
  });
  await db.insert(accessManifestCheckpoints).values({
    objectKind: "container",
    objectId: rootId,
    organizationId: oldOrganizationId,
    epoch: 2,
    manifestHash: "a".repeat(64),
    updatedAt,
  });
  await db.insert(principalPolicyCheckpoints).values({
    principalType: "organization",
    principalId: oldOrganizationId,
    version: 2,
    stateHash: "b".repeat(64),
    updatedAt,
  });
  await db.insert(principalPolicyOrganizations).values({
    principalType: "organization",
    principalId: oldOrganizationId,
    organizationId: oldOrganizationId,
  });
  session.setContext({
    organizationId: oldOrganizationId,
    defaultOrganizationId: oldOrganizationId,
    containerId: rootId,
    userId,
  });
  const protectedState = () =>
    Promise.all(
      [
        containers,
        accessManifestCheckpoints,
        principalPolicyCheckpoints,
        principalPolicyOrganizations,
      ].map((table) => db.select().from(table)),
    );
  return {
    close,
    execSql,
    db,
    identity,
    session,
    oldOrganizationId,
    userId,
    rootId,
    requests,
    protectedState,
    clearCount: () => clearCount,
  };
}
