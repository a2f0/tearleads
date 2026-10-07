import { beforeAll, expect, test } from "bun:test";
import type { PrincipalPolicyExternalAuthority } from "@tearleads/crypto";
import { createOrganizationHistoryFixture } from "../../../test/helpers/organizationPolicyHistory";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { createPublicHistoryFixture } from "../../../test/helpers/publicPrincipalHistory";
import { principalHistoryPrefixes } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { recoverPublicPrincipalHistory } from "./recoverPublicPrincipalHistory";

let history: Awaited<ReturnType<typeof createOrganizationHistoryFixture>>;
beforeAll(async () => {
  history = await createOrganizationHistoryFixture();
}, 30_000);

test("public organization history rejects a different organization scope", async () => {
  const f = await createPublicHistoryFixture({
    ...history,
    bundle: history.initial,
  });
  try {
    await recoverPublicPrincipalHistory({
      ...f.options,
      organizationId: history.organizationId,
    });
    f.requests.length = 0;
    await expect(
      recoverPublicPrincipalHistory({
        ...f.options,
        organizationId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("Public organization history is outside its scope");
    expect(f.requests).toEqual([]);
    expect(await f.db.select().from(principalHistoryPrefixes)).toHaveLength(1);
  } finally {
    f.close();
  }
});

async function groupFixture() {
  const f = await createPublicHistoryFixture(
    { ...history, bundle: history.created },
    [history.admin],
  );
  try {
    const verified = await recoverPublicPrincipalHistory({
      ...f.options,
      organizationId: history.organizationId,
      source: f.source(history.admin),
      strictAdmins: true,
    });
    const state = verified.history.currentEntry.state;
    const authority: PrincipalPolicyExternalAuthority = {
      currentHead: {
        ...principalPolicyHead(history.admin),
        principalType: "group",
      },
      states: [
        {
          head: {
            principalType: "group",
            principalId: state.principalId,
            version: state.version,
            stateHash: state.stateHash,
            keyEpoch: state.keyEpoch,
            keyFingerprint: state.keyFingerprint,
          },
          projection: verified.history.currentEntry.projection,
        },
      ],
    };
    f.requests.length = 0;
    return {
      ...f,
      authority,
      options: {
        ...f.options,
        organizationId: history.organizationId,
        authorityGroupId: state.principalId,
        loadExternalAuthority: async () => authority,
      },
    };
  } catch (error) {
    f.close();
    throw error;
  }
}

test("public history binds signed external citations to the verified directory authority", async () => {
  const f = await groupFixture();
  try {
    const recovered = await recoverPublicPrincipalHistory(f.options);
    expect(recovered.history.currentEntry.state.stateHash).toBe(
      history.created.currentState.stateHash,
    );
    await expect(
      recoverPublicPrincipalHistory({
        ...f.options,
        authorityGroupId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("outside its directory binding");
    expect(await f.db.select().from(principalHistoryPrefixes)).toHaveLength(2);
  } finally {
    f.close();
  }
});

test("public history rejects authority callback evidence from another directory group", async () => {
  const f = await groupFixture();
  try {
    const other = {
      head: { ...f.authority.currentHead, principalId: crypto.randomUUID() },
      projection: f.authority.states[0]?.projection ?? [],
    };
    await expect(
      recoverPublicPrincipalHistory({
        ...f.options,
        loadExternalAuthority: async () => ({
          currentHead: other.head,
          states: [...f.authority.states, other],
        }),
      }),
    ).rejects.toThrow("Authority callback differs from the directory binding");
    expect(await f.db.select().from(principalHistoryPrefixes)).toHaveLength(1);
  } finally {
    f.close();
  }
});
