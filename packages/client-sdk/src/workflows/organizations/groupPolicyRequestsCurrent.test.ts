import { beforeAll, expect, test } from "bun:test";
import { toFingerprint, verifyPrincipalPolicyBundle } from "@tearleads/crypto";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import {
  policyBundleAfterMutation,
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "../../../test/helpers/principalPolicyFixtures";
import { recoverScopedPrincipalPolicyHistory } from "../principals/recoverScopedPrincipalPolicyHistory";
import { buildSetGroupContainerGrantPolicyRequest } from "./groupPolicyRequests";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
});

async function fixture(source = history) {
  const f = await createAuthorityRecoveryFixture(source);
  const recovered = await recoverScopedPrincipalPolicyHistory(f.options);
  const lifetime = { current: true };
  const admin = history.admin;
  const externalAuthority = {
    currentHead: {
      ...principalPolicyHead(admin),
      principalType: "group" as const,
    },
    states: [
      ...admin.previousStates,
      {
        state: admin.currentState,
        projection: admin.currentProjection,
        grants: admin.currentGrants,
      },
    ].map(({ state, projection }) => ({
      head: { ...state, principalType: "group" as const },
      projection,
    })),
  };
  const input = {
    currentPolicy: recovered.current,
    verifiedCurrentPolicy: recovered.policy,
    stillCurrent: () => lifetime.current,
    localPolicyCheckpoint: recovered.policy.checkpoint,
    currentOrgAdminUserIds: [history.signerUserId],
    externalAuthority,
    signerUserId: history.signerUserId,
    signingFingerprint: await toFingerprint(
      history.signingKeyPair.signingPublicKey,
    ),
    signingKeyPair: history.signingKeyPair,
    accessLevel: "read" as const,
    containerId: crypto.randomUUID(),
  };
  return { ...f, input, lifetime };
}

test("a current-only group signs a valid successor without reconstructing its history", async () => {
  const f = await fixture();
  try {
    expect(f.input.currentPolicy).not.toHaveProperty("previousStates");
    expect(f.input.verifiedCurrentPolicy).not.toHaveProperty("history");
    const count = f.requests.length;
    const request = await buildSetGroupContainerGrantPolicyRequest(f.input);
    expect(request.state.version).toBe(67);
    expect(request.state.prevStateHash).toBe(
      history.group.currentState.stateHash,
    );
    expect(request.grants).toEqual([
      { containerId: f.input.containerId, accessLevel: "read" },
    ]);
    const checked = await verifyPrincipalPolicyBundle({
      bundle: await policyBundleAfterMutation({
        previous: history.group,
        mutation: request,
      }),
      externalAuthority: f.input.externalAuthority,
      localCheckpoint: f.input.localPolicyCheckpoint,
      signerPublicKeys: [
        {
          userId: history.signerUserId,
          signingKeyFingerprint: f.input.signingFingerprint,
          signingPublicKey: history.signingKeyPair.signingPublicKey,
        },
      ],
    });
    expect(checked.ok).toBe(true);
    expect(f.requests).toHaveLength(count);
  } finally {
    f.close();
  }
});

test.each(["signature", "payload"] as const)(
  "a substituted current %s cannot be signed over",
  async (field) => {
    const f = await fixture();
    try {
      if (field === "signature")
        f.input.currentPolicy.currentState.signature = "substituted";
      else f.input.currentPolicy.currentPayload.ciphertext += "substituted";
      await expect(
        buildSetGroupContainerGrantPolicyRequest(f.input),
      ).rejects.toMatchObject({ code: "equivocation" });
    } finally {
      f.close();
    }
  },
);

test("current mutation checks checkpoint consistency and signer authority", async () => {
  const f = await fixture();
  try {
    await expect(
      buildSetGroupContainerGrantPolicyRequest({
        ...f.input,
        localPolicyCheckpoint: {
          ...f.input.localPolicyCheckpoint,
          stateHash: "f".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: "equivocation" });
    await expect(
      buildSetGroupContainerGrantPolicyRequest({
        ...f.input,
        signerUserId: "unauthorized",
      }),
    ).rejects.toThrow("Group admin membership is required");
  } finally {
    f.close();
  }
});

test("expiry while capturing signing inputs prevents a current-policy mutation", async () => {
  const f = await fixture();
  try {
    let reachedSigning = false;
    await expect(
      buildSetGroupContainerGrantPolicyRequest({
        ...f.input,
        get signingKeyPair() {
          reachedSigning = true;
          f.lifetime.current = false;
          return history.signingKeyPair;
        },
      }),
    ).rejects.toThrow("generation expired");
    expect(reachedSigning).toBe(true);
  } finally {
    f.close();
  }
});

test("current mutation rejects copied verification evidence", async () => {
  const f = await fixture();
  try {
    await expect(
      buildSetGroupContainerGrantPolicyRequest({
        ...f.input,
        verifiedCurrentPolicy: { ...f.input.verifiedCurrentPolicy },
      }),
    ).rejects.toMatchObject({ code: "invalid_shape" });
  } finally {
    f.close();
  }
});

test("mutating both public evidence and matching wire artifacts cannot replace the predecessor", async () => {
  const f = await fixture();
  try {
    f.input.currentPolicy.currentState.signature = "substituted";
    f.input.verifiedCurrentPolicy.state.signature = "substituted";
    await expect(
      buildSetGroupContainerGrantPolicyRequest(f.input),
    ).rejects.toMatchObject({ code: "hash_mismatch" });
  } finally {
    f.close();
  }
});

test("current mutation cannot cite an older Admins head than the verified prefix", async () => {
  const group = await signedPrincipalPolicyBundle({
    memberEnvelopes: history.group.currentMemberEnvelopes.envelopes,
    payloadCiphertext: history.group.currentPayload.ciphertext,
    projection: history.group.currentProjection,
    previousStates: history.group.previousStates,
    signing: {
      ...history.group.currentState,
      grants: history.group.currentGrants,
      externalAuthority: {
        ...principalPolicyHead(history.admin),
        principalType: "group",
      },
    },
    signingPrivateKey: history.signingKeyPair.signingPrivateKey,
  });
  const directory = await history.advanceDirectory(history.directory, group);
  const f = await fixture({ ...history, group, directory });
  try {
    const previousAuthority = f.input.externalAuthority.states.at(-2);
    if (!previousAuthority) throw new Error("Expected previous authority");
    await expect(
      buildSetGroupContainerGrantPolicyRequest({
        ...f.input,
        externalAuthority: {
          ...f.input.externalAuthority,
          currentHead: previousAuthority.head,
        },
      }),
    ).rejects.toMatchObject({ code: "rollback" });
  } finally {
    f.close();
  }
});

test("current mutation owns its input before verification yields", async () => {
  const f = await fixture();
  try {
    const unexpectedContainer = crypto.randomUUID();
    const pending = buildSetGroupContainerGrantPolicyRequest(f.input);
    f.input.currentPolicy.currentGrants.push({
      containerId: unexpectedContainer,
      accessLevel: "write",
    });
    const request = await pending;
    expect(request.grants).toEqual([
      { containerId: f.input.containerId, accessLevel: "read" },
    ]);
  } finally {
    f.close();
  }
});

test("organization admin labels cannot override the selected authority's signer membership", async () => {
  const f = await fixture();
  try {
    await expect(
      buildSetGroupContainerGrantPolicyRequest({
        ...f.input,
        signerUserId: "unauthorized",
        currentOrgAdminUserIds: ["unauthorized"],
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  } finally {
    f.close();
  }
});
