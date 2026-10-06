import { beforeAll, expect, test } from "bun:test";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { advanceKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { recoverScopedPrincipalPolicyHistory } from "./recoverScopedPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
});

test("scoped recovery pages directory, strict Admins and an externally authorized group", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    const recovered = await recoverScopedPrincipalPolicyHistory(
      fixture.options,
    );
    expect(recovered.policy.stateHash).toBe(
      history.group.currentState.stateHash,
    );
    expect(recovered.dependencies.map((policy) => policy.stateHash)).toEqual([
      history.directory.currentState.stateHash,
      history.admin.currentState.stateHash,
    ]);
    for (const bundle of [history.directory, history.admin, history.group]) {
      const offsets = fixture.requests
        .filter(
          (request) => request.principalId === bundle.currentState.principalId,
        )
        .map((request) => request.afterVersion);
      expect(offsets).toContain(0);
      expect(offsets).toContain(32);
      expect(offsets).toContain(64);
    }
    expect(fixture.requests.every((request) => request.count <= 32)).toBe(true);
    expect(await fixture.db.select().from(principalPolicyCheckpoints)).toEqual(
      [],
    );
    await advanceKeyingCheckpointsAtomically({
      access: [],
      execSql: fixture.options.execSql,
      organizationId: history.organizationId,
      policies: [...recovered.dependencies, recovered.policy],
      stillCurrent: () => true,
    });
    expect(
      await fixture.db.select().from(principalPolicyCheckpoints),
    ).toHaveLength(3);
    fixture.requests.length = 0;
    await recoverScopedPrincipalPolicyHistory(fixture.options);
    expect(
      fixture.requests.filter((request) => request.afterVersion === 0),
    ).toHaveLength(1);
    expect(
      fixture.requests.every(
        (request) => request.afterVersion === 0 || request.afterVersion === 65,
      ),
    ).toBe(true);
  } finally {
    fixture.close();
  }
});

test("a current signed directory can authenticate an older group citation", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    const recovered = await recoverScopedPrincipalPolicyHistory({
      ...fixture.options,
      reference: principalPolicyHead(history.created),
    });
    expect(
      recovered.policy.retainedHistory.map(({ state }) => state.version),
    ).toEqual([1, 66]);
  } finally {
    fixture.close();
  }
});

test("a directory payload substitution is rejected before any group is fetched", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    fixture.controls.mutate = (page) => {
      if (page.currentState.principalType === "organization")
        page.currentPayload.ciphertext += "changed";
    };
    await expect(
      recoverScopedPrincipalPolicyHistory(fixture.options),
    ).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(
      fixture.requests.every(
        (request) => request.principalId === history.organizationId,
      ),
    ).toBe(true);
    expect(await fixture.db.select().from(principalPolicyCheckpoints)).toEqual(
      [],
    );
  } finally {
    fixture.close();
  }
});
