import { expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createOrganization } from "../organizations/createOrganization";
import { createPrincipalCurrentRecoveryBatch } from "../principals/principalCurrentRecoveryBatch";
import { createProvisionedPrincipalHistoryPrimer } from "./provisionedPrincipalHistory";
import {
  principalPolicyBundleFromInitialGroupRequest,
  principalPolicyBundleFromInitialOrganizationRequest,
} from "./registrationPrincipalPolicyPersistence";

const protection = {
  context: "provisioned-principal-history-test",
  localKey: new Uint8Array(32).fill(7),
};
const lease: PrincipalHistoryProtectionLease = (operation) =>
  operation({ protection, stillCurrent: () => true });

async function founder() {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const trusted = createTestTrustedUserIdentity({
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    signingKeyFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
    signingPublicKey: signingKeyPair.signingPublicKey,
    userId,
  });
  return { encapsulationKeyPair, signingKeyPair, trusted, userId };
}

type Founder = Awaited<ReturnType<typeof founder>>;

async function provision(input: {
  readonly execSql: ExecSql;
  readonly founder: Founder;
  readonly lease?: PrincipalHistoryProtectionLease | undefined;
  readonly logError?: (message: string | Error, cause?: unknown) => void;
}) {
  let request: CreateOrganizationRequest | null = null;
  await createOrganization({
    apiClient: {
      createOrganization: async (value) => {
        request = value;
        return respondToOrganizationProvisioning(value);
      },
    },
    dbClient: execSqlClientFromExecSql(input.execSql),
    encapsulationKeyPair: input.founder.encapsulationKeyPair,
    ...(input.lease
      ? {
          primePrincipalHistory: createProvisionedPrincipalHistoryPrimer({
            bindLease: () => input.lease,
            execSql: () => input.execSql,
            localIdentity: () => ({
              encapsulationPublicKey:
                input.founder.encapsulationKeyPair.publicKey,
              signingPublicKey: input.founder.signingKeyPair.signingPublicKey,
            }),
            logError: input.logError ?? (() => undefined),
            pinLocalUserIdentity: async () => input.founder.trusted,
          }),
        }
      : {}),
    signingKeyPair: input.founder.signingKeyPair,
    userId: input.founder.userId,
  });
  if (!request) throw new Error("Expected a provisioning request");
  return request as CreateOrganizationRequest;
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
  const [, adminGroup, memberGroup] = bundles;
  if (!adminGroup || !memberGroup) throw new Error("Expected group heads");
  return { adminGroup, apiClient, memberGroup, reads };
}

async function recoverFoundingGroups(input: {
  readonly execSql: ExecSql;
  readonly founder: Founder;
  readonly request: CreateOrganizationRequest;
}) {
  const server = await committedServer(input.request);
  const { recover } = createPrincipalCurrentRecoveryBatch();
  for (const group of [server.adminGroup, server.memberGroup])
    await recover({
      apiClient: server.apiClient,
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

test("primed founding heads need only the directory discovery read", async () => {
  const { close, execSql } = await createTestExecSql(
    "provisioned-principal-history",
  );
  try {
    const owner = await founder();
    const request = await provision({ execSql, founder: owner, lease });
    const reads = await recoverFoundingGroups({
      execSql,
      founder: owner,
      request,
    });
    expect(reads).toEqual([{ principalType: "organization" }]);
  } finally {
    close();
  }
});

test("without priming the founding group heads are read from genesis", async () => {
  const { close, execSql } = await createTestExecSql(
    "provisioned-principal-history-control",
  );
  try {
    const owner = await founder();
    const request = await provision({ execSql, founder: owner });
    const reads = await recoverFoundingGroups({
      execSql,
      founder: owner,
      request,
    });
    expect(reads.filter((read) => read.principalType === "group")).toEqual([
      {
        principalType: "group",
        stateHash: expect.any(String),
      },
      {
        principalType: "group",
        stateHash: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});

test("a priming failure keeps provisioning and online recovery", async () => {
  const { close, execSql } = await createTestExecSql(
    "provisioned-principal-history-failure",
  );
  try {
    const owner = await founder();
    const errors: unknown[] = [];
    const request = await provision({
      execSql,
      founder: owner,
      lease: async () => {
        throw new Error("custody unavailable");
      },
      logError: (_message, cause) => errors.push(cause),
    });
    expect(errors).toEqual([new Error("custody unavailable")]);
    const reads = await recoverFoundingGroups({
      execSql,
      founder: owner,
      request,
    });
    expect(reads.filter((read) => read.principalType === "group")).toHaveLength(
      2,
    );
  } finally {
    close();
  }
});

test("a rejected provisioning acknowledgement primes nothing", async () => {
  const { close, execSql } = await createTestExecSql(
    "provisioned-principal-history-rejected",
  );
  try {
    const owner = await founder();
    let primed = 0;
    await expect(
      createOrganization({
        apiClient: {
          createOrganization: async (value) => ({
            ...(await respondToOrganizationProvisioning(value)),
            rosterProfileContainer: undefined,
          }),
        },
        dbClient: execSqlClientFromExecSql(execSql),
        encapsulationKeyPair: owner.encapsulationKeyPair,
        logError: () => undefined,
        primePrincipalHistory: async () => {
          primed += 1;
        },
        signingKeyPair: owner.signingKeyPair,
        userId: owner.userId,
      }),
    ).rejects.toThrow("missing roster profile container");
    expect(primed).toBe(0);
  } finally {
    close();
  }
});
