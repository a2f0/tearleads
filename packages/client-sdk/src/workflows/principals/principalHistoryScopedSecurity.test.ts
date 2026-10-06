import { beforeAll, expect, test } from "bun:test";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "../../../test/helpers/principalPolicyFixtures";
import {
  encodeOrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
} from "../../data/principals/organizationAuthorityDescriptor";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";
import { recoverScopedPrincipalPolicyHistory } from "./recoverScopedPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
});

test("scoped recovery rejects invalid key material before discovery", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    const options = {
      ...fixture.options,
      protection: { ...fixture.options.protection },
    };
    Reflect.set(options.protection, "localKey", 32);
    await expect(
      recoverScopedPrincipalPolicyHistory(options),
    ).rejects.toMatchObject({ code: "invalid_shape" });
    expect(fixture.requests).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("generic cached group history cannot bypass the directory's Admins authority", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    const foreign = await history.createGroup("Unlisted authority");
    const group = await history.createGroup(
      "Wrong authority group",
      false,
      foreign,
    );
    const directory = await history.advanceDirectory(history.directory, group);
    fixture.policies.set(foreign.currentState.principalId, foreign);
    fixture.policies.set(group.currentState.principalId, group);
    fixture.policies.set(history.organizationId, directory);
    const authority = await recoverPrincipalPolicyHistory({
      ...fixture.options,
      expectedHead: principalPolicyHead(foreign),
    });
    await recoverPrincipalPolicyHistory({
      ...fixture.options,
      expectedHead: principalPolicyHead(group),
      loadExternalAuthority: async () => ({
        currentHead: {
          ...principalPolicyHead(foreign),
          principalType: "group",
        },
        states: [
          {
            head: { ...principalPolicyHead(foreign), principalType: "group" },
            projection: authority.policy.projection,
          },
        ],
      }),
    });
    await expect(
      recoverScopedPrincipalPolicyHistory({
        ...fixture.options,
        reference: principalPolicyHead(group),
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  } finally {
    fixture.close();
  }
});

test("a genuinely signed directory cannot relabel another organization", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    const descriptor = parseOrganizationAuthorityDescriptor(
      history.directory.currentPayload.ciphertext,
    );
    const directory = await signedPrincipalPolicyBundle({
      memberEnvelopes: history.directory.currentMemberEnvelopes.envelopes,
      projection: history.directory.currentProjection,
      previousStates: history.directory.previousStates,
      payloadCiphertext: encodeOrganizationAuthorityDescriptor({
        ...descriptor,
        organizationId: crypto.randomUUID(),
      }),
      signing: history.directory.currentState,
      signingPrivateKey: history.signingKeyPair.signingPrivateKey,
    });
    fixture.policies.set(history.organizationId, directory);
    await expect(
      recoverScopedPrincipalPolicyHistory(fixture.options),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    expect(
      fixture.requests.every(
        (request) => request.principalId === history.organizationId,
      ),
    ).toBe(true);
  } finally {
    fixture.close();
  }
});

test("a group advancing during directory paging gets one fresh directory read", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    const group = await history.extend(history.group, 67);
    const directory = await history.advanceDirectory(history.directory, group);
    fixture.policies.set(group.currentState.principalId, group);
    fixture.controls.mutate = (page) => {
      if (
        page.currentState.principalId === history.organizationId &&
        page.historyPage.afterVersion === 64
      )
        fixture.policies.set(history.organizationId, directory);
    };
    const recovered = await recoverScopedPrincipalPolicyHistory({
      ...fixture.options,
      reference: principalPolicyHead(group),
    });
    expect(recovered.policy.version).toBe(67);
    expect(recovered.dependencies[0]?.version).toBe(67);
    expect(
      fixture.requests
        .filter((request) => request.principalId === history.organizationId)
        .map((request) => request.afterVersion),
    ).toEqual([0, 0, 32, 64, 0, 66]);
  } finally {
    fixture.close();
  }
});
