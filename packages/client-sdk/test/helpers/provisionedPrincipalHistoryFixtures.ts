import type { ApiClient } from "@tearleads/api-client";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { PrincipalHistoryProtectionLease } from "../../src/data/principals/principalHistoryProtection";
import { principalPolicyReferenceFromBundle } from "../../src/data/principals/principalPolicyAdminSigners";
import type {
  ExecSql,
  ExecSqlClientLike,
} from "../../src/data/sqlite/sqlSchema";
import {
  createTrustedUserIdentityService,
  loadPinnedUserIdentity,
} from "../../src/data/trustedUserIdentity";
import { createOrganization } from "../../src/workflows/organizations/provisioning/createOrganization";
import { createPrincipalCurrentRecoveryBatch } from "../../src/workflows/principals/recoveryOperation/principalCurrentRecoveryBatch";
import {
  createProvisionedPrincipalHistoryPrimer,
  type ProvisionedPrincipalHistoryPrimer,
} from "../../src/workflows/registration/provisionedPrincipalHistory";
import {
  principalPolicyBundleFromInitialGroupRequest,
  principalPolicyBundleFromInitialOrganizationRequest,
} from "../../src/workflows/registration/registrationPrincipalPolicyPersistence";
import { execSqlClientFromExecSql } from "./execSqlClient";
import { respondToOrganizationProvisioning } from "./organizationProvisioningResponder";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

const PRIMING_TRUST_DOMAIN = "https://api.example.test";
const protection = {
  context: "provisioned-principal-history-test",
  localKey: new Uint8Array(32).fill(7),
};

export async function createFounder() {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const userId = crypto.randomUUID();
  const trusted = createTestTrustedUserIdentity({
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    signingKeyFingerprint: signingFingerprint,
    signingPublicKey: signingKeyPair.signingPublicKey,
    userId,
  });
  return {
    encapsulationKeyPair,
    signingFingerprint,
    signingKeyPair,
    trusted,
    userId,
  };
}

export type Founder = Awaited<ReturnType<typeof createFounder>>;

/** Registration pins the founder's keys before the bootstrap persists. */
export async function pinFounder(execSql: ExecSql, founder: Founder) {
  await createTrustedUserIdentityService({
    getExecSql: () => execSql,
    getLocalIdentity: () => null,
    getLocalUserId: () => null,
    identityTrustDomain: PRIMING_TRUST_DOMAIN,
    remoteSource: { invalidate: () => undefined, load: async () => null },
  }).pinLocal(founder.userId, {
    encapsulationPublicKey: founder.encapsulationKeyPair.publicKey,
    signingPublicKey: founder.signingKeyPair.signingPublicKey,
  });
}

interface RuntimeDatabase {
  readonly client: ExecSqlClientLike;
  readonly execSql: ExecSql;
}

export function runtimeDatabase(execSql: ExecSql): RuntimeDatabase {
  return { client: execSqlClientFromExecSql(execSql), execSql };
}

/**
 * A runtime whose active database and identity can be switched, like an SDK
 * client whose host swaps identities. Its lease, like the real custody, stays
 * current only while the database and identity it was bound to are.
 */
export function createPrimingRuntime(input: {
  readonly database: RuntimeDatabase;
  readonly signingFingerprint: string;
  readonly lease?: PrincipalHistoryProtectionLease | undefined;
  readonly loadPinnedIdentity?: typeof loadPinnedUserIdentity | undefined;
}) {
  const state = {
    database: input.database,
    signingFingerprint: input.signingFingerprint,
  };
  const errors: unknown[] = [];
  const scopeLease: PrincipalHistoryProtectionLease = (operation) => {
    const bound = { ...state };
    return operation({
      protection,
      stillCurrent: () =>
        state.database === bound.database &&
        state.signingFingerprint === bound.signingFingerprint,
    });
  };
  const load = input.loadPinnedIdentity ?? loadPinnedUserIdentity;
  const primer: ProvisionedPrincipalHistoryPrimer =
    createProvisionedPrincipalHistoryPrimer({
      bindLease: () => input.lease ?? scopeLease,
      execSqlFor: (client) =>
        state.database.client === client ? state.database.execSql : null,
      loadPinnedIdentity: (execSql, userId) =>
        load({ execSql, identityTrustDomain: PRIMING_TRUST_DOMAIN, userId }),
      logError: (_message, cause) => errors.push(cause),
      signingFingerprint: () => state.signingFingerprint,
    });
  return {
    errors,
    primer,
    state,
    /** The session's identity-currency check for the founder's snapshot. */
    isFounderCurrent: (founder: Founder) => () =>
      state.signingFingerprint === founder.signingFingerprint,
    switchTo(database: RuntimeDatabase, signingFingerprint: string) {
      state.database = database;
      state.signingFingerprint = signingFingerprint;
    },
  };
}

export async function provisionOrganization(input: {
  readonly database: RuntimeDatabase;
  readonly founder: Founder;
  readonly isIdentityCurrent?: (() => boolean) | undefined;
  readonly primePrincipalHistory?: ProvisionedPrincipalHistoryPrimer;
}): Promise<CreateOrganizationRequest> {
  const captured: { request?: CreateOrganizationRequest } = {};
  await createOrganization({
    apiClient: {
      createOrganization: async (value) => {
        captured.request = value;
        return respondToOrganizationProvisioning(value);
      },
    },
    dbClient: input.database.client,
    encapsulationKeyPair: input.founder.encapsulationKeyPair,
    isIdentityCurrent: input.isIdentityCurrent,
    primePrincipalHistory: input.primePrincipalHistory,
    signingKeyPair: input.founder.signingKeyPair,
    userId: input.founder.userId,
  });
  if (!captured.request) throw new Error("Expected a provisioning request");
  return captured.request;
}

/** The committed heads as the API serves them; every read is recorded. */
async function committedServer(request: CreateOrganizationRequest) {
  const bundles: PrincipalPolicyBundleResponse[] = [
    await principalPolicyBundleFromInitialOrganizationRequest(
      request.initialOrganizationPolicy,
    ),
    await principalPolicyBundleFromInitialGroupRequest(
      request.initialAdminGroup,
    ),
    await principalPolicyBundleFromInitialGroupRequest(
      request.initialMemberGroup,
    ),
  ];
  const reads: { principalType: string; stateHash?: string | undefined }[] = [];
  const apiClient: Pick<ApiClient, "getPrincipalPolicyPages"> = {
    async *getPrincipalPolicyPages(principalType, principalId, options = {}) {
      reads.push({ principalType, stateHash: options.stateHash });
      const bundle = bundles.find(
        ({ currentState }) => currentState.principalId === principalId,
      );
      if (!bundle) throw new Error(`Unexpected principal ${principalId}`);
      yield {
        ok: true,
        data: {
          ...structuredClone(bundle),
          historyPage: { afterVersion: 0, nextAfterVersion: null },
        },
      };
    },
  };
  return { bundles, apiClient, reads };
}

/** Runtime-style scoped recovery of the founding groups against the API. */
export async function recoverFoundingGroups(input: {
  readonly execSql: ExecSql;
  readonly founder: Founder;
  readonly request: CreateOrganizationRequest;
}) {
  const server = await committedServer(input.request);
  const { recover } = createPrincipalCurrentRecoveryBatch();
  for (const group of server.bundles.slice(1))
    await recover({
      historyReader: server.apiClient,
      execSql: input.execSql,
      offline: false,
      organizationId: input.request.organizationId,
      protection,
      reference: principalPolicyReferenceFromBundle(group),
      resolveTrustedUserIdentity: async (userId) =>
        userId === input.founder.userId ? input.founder.trusted : null,
      stillCurrent: () => true,
    });
  return server.reads;
}

/** Non-empty trust-pin and principal-history tables with their row counts. */
export async function durablePrimingRows(execSql: ExecSql) {
  const tables = await execSql(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'principal_history%' OR name = 'trusted_user_identity_pins') ORDER BY name",
  );
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const [{ count } = {}] = await execSql(
      `SELECT COUNT(*) AS count FROM ${String(name)}`,
    );
    const rows = Number(count ?? 0);
    if (rows > 0) counts[String(name)] = rows;
  }
  return counts;
}
