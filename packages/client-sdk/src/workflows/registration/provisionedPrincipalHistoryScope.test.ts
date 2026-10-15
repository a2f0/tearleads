import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createFounder,
  createPrimingRuntime,
  durablePrimingRows,
  pinFounder,
  provisionOrganization,
  recoverFoundingGroups,
  runtimeDatabase,
} from "../../../test/helpers/provisionedPrincipalHistoryFixtures";
import { loadTrustedUserIdForSigningKey } from "../../data/persistence/trustedUserIdentityPinPersistence";
import { loadPinnedUserIdentity } from "../../data/trustedUserIdentity";

const TRUST_DOMAIN = "https://api.example.test";

async function twoDatabases(label: string) {
  const first = await createTestExecSql(`${label}-provisioning`);
  const second = await createTestExecSql(`${label}-replacement`);
  return {
    first,
    second,
    close() {
      first.close();
      second.close();
    },
  };
}

test("an identity and database switch before priming writes nothing durable", async () => {
  const databases = await twoDatabases("priming-scope-switch");
  try {
    const owner = await createFounder();
    const replacement = await createFounder();
    await pinFounder(databases.first.execSql, owner);
    const provisioning = runtimeDatabase(databases.first.execSql);
    const replaced = runtimeDatabase(databases.second.execSql);
    const runtime = createPrimingRuntime({
      database: provisioning,
      signingFingerprint: owner.signingFingerprint,
    });
    const before = {
      first: await durablePrimingRows(databases.first.execSql),
      second: await durablePrimingRows(databases.second.execSql),
    };
    const request = await provisionOrganization({
      database: provisioning,
      founder: owner,
      isIdentityCurrent: runtime.isFounderCurrent(owner),
      // The host swaps identity and database after the bootstrap commits.
      primePrincipalHistory: async (input) => {
        runtime.switchTo(replaced, replacement.signingFingerprint);
        await runtime.primer(input);
      },
    });
    expect(await durablePrimingRows(databases.first.execSql)).toEqual(
      before.first,
    );
    expect(await durablePrimingRows(databases.second.execSql)).toEqual(
      before.second,
    );
    // Nothing binds the replacement key, so it can still register or log in.
    expect(
      await loadTrustedUserIdForSigningKey({
        execSql: databases.second.execSql,
        identityTrustDomain: TRUST_DOMAIN,
        signingKeyFingerprint: replacement.signingFingerprint,
      }),
    ).toBeNull();
    // No-brick: the founder's own database still recovers online.
    const reads = await recoverFoundingGroups({
      execSql: databases.first.execSql,
      founder: owner,
      request,
    });
    expect(reads.filter((read) => read.principalType === "group")).toHaveLength(
      2,
    );
  } finally {
    databases.close();
  }
});

test("a switch during priming aborts before any progress write", async () => {
  const databases = await twoDatabases("priming-scope-mid-switch");
  try {
    const owner = await createFounder();
    const replacement = await createFounder();
    await pinFounder(databases.first.execSql, owner);
    const provisioning = runtimeDatabase(databases.first.execSql);
    const replaced = runtimeDatabase(databases.second.execSql);
    const runtime = createPrimingRuntime({
      database: provisioning,
      // The switch lands while the founder's pin is being read.
      loadPinnedIdentity: async (input) => {
        const identity = await loadPinnedUserIdentity(input);
        runtime.switchTo(replaced, replacement.signingFingerprint);
        return identity;
      },
      signingFingerprint: owner.signingFingerprint,
    });
    const before = await durablePrimingRows(databases.first.execSql);
    await provisionOrganization({
      database: provisioning,
      founder: owner,
      isIdentityCurrent: runtime.isFounderCurrent(owner),
      primePrincipalHistory: runtime.primer,
    });
    expect(runtime.errors).toHaveLength(1);
    expect(await durablePrimingRows(databases.first.execSql)).toEqual(before);
    expect(await durablePrimingRows(databases.second.execSql)).toEqual({});
  } finally {
    databases.close();
  }
});
