import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import {
  createFounder,
  createPrimingRuntime,
  pinFounder,
  provisionOrganization,
  recoverFoundingGroups,
  runtimeDatabase,
} from "../../../test/helpers/provisionedPrincipalHistoryFixtures";
import { createOrganization } from "../organizations/createOrganization";

test("primed founding heads need only the directory discovery read", async () => {
  const { close, execSql } = await createTestExecSql(
    "provisioned-principal-history",
  );
  try {
    const owner = await createFounder();
    await pinFounder(execSql, owner);
    const database = runtimeDatabase(execSql);
    const runtime = createPrimingRuntime({
      database,
      signingFingerprint: owner.signingFingerprint,
    });
    const request = await provisionOrganization({
      database,
      founder: owner,
      isIdentityCurrent: runtime.isFounderCurrent(owner),
      primePrincipalHistory: runtime.primer,
    });
    expect(runtime.errors).toEqual([]);
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
    const owner = await createFounder();
    const request = await provisionOrganization({
      database: runtimeDatabase(execSql),
      founder: owner,
    });
    const reads = await recoverFoundingGroups({
      execSql,
      founder: owner,
      request,
    });
    expect(reads.filter((read) => read.principalType === "group")).toEqual([
      { principalType: "group", stateHash: expect.any(String) },
      { principalType: "group", stateHash: expect.any(String) },
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
    const owner = await createFounder();
    await pinFounder(execSql, owner);
    const database = runtimeDatabase(execSql);
    const runtime = createPrimingRuntime({
      database,
      lease: async () => {
        throw new Error("custody unavailable");
      },
      signingFingerprint: owner.signingFingerprint,
    });
    const request = await provisionOrganization({
      database,
      founder: owner,
      primePrincipalHistory: runtime.primer,
    });
    expect(runtime.errors).toEqual([new Error("custody unavailable")]);
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
    const owner = await createFounder();
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
