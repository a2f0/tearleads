import { beforeAll, expect, test } from "bun:test";
import {
  signPrincipalState,
  verifyPrincipalPolicyCurrentSuccessor,
} from "@tearleads/crypto";
import { currentPolicyAcknowledgementFixture } from "../../../test/helpers/currentPolicyAcknowledgement";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import {
  acknowledgeGroupPolicyState,
  prepareAuthoredGroupPolicy,
} from "./groupPolicyMutationAcknowledgement";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
});

test.each(["group", "organization"] as const)(
  "paged %s evidence prepares and acknowledges one successor without a full history",
  async (kind) => {
    const f = await currentPolicyAcknowledgementFixture(history, kind);
    try {
      const count = f.requests.length;
      expect(f.currentPolicy).not.toHaveProperty("previousStates");
      for (const policy of [
        await prepareAuthoredGroupPolicy(f.input),
        await acknowledgeGroupPolicyState({
          ...f.input,
          response: f.response.currentState,
        }),
      ]) {
        expect(policy.version).toBe(67);
        expect(policy.stateHash).toBe(f.input.expectedHead.stateHash);
        expect(policy).not.toHaveProperty("history");
        expect(
          policy.retainedHistory.map(({ state }) => state.version),
        ).toEqual([66, 67]);
      }
      expect(f.requests).toHaveLength(count);
    } finally {
      f.close();
    }
  },
);

test.each(["group", "organization"] as const)(
  "current %s acknowledgement requires the exact signed response, even with the same claimed hash",
  async (kind) => {
    const f = await currentPolicyAcknowledgementFixture(history, kind);
    try {
      const resigned = await signPrincipalState(
        f.input.request.state,
        history.signingKeyPair.signingPrivateKey,
      );
      expect(resigned.signature).not.toBe(f.input.request.state.signature);
      const response = {
        ...f.response.currentState,
        signature: resigned.signature,
      };
      const checked = await verifyPrincipalPolicyCurrentSuccessor({
        previous: f.input.verifiedCurrentPolicy,
        current: { ...f.response, currentState: response },
        signerPublicKeys: f.input.signerPublicKeys,
        externalAuthority: f.input.externalAuthority,
      });
      expect(checked.ok).toBe(true);
      await expect(
        acknowledgeGroupPolicyState({
          ...f.input,
          response,
        }),
      ).rejects.toThrow("Group policy state acknowledgement mismatch");
    } finally {
      f.close();
    }
  },
);

test("current preparation rejects copied proof and a conflicting local checkpoint", async () => {
  const f = await currentPolicyAcknowledgementFixture(history, "group");
  try {
    await expect(
      prepareAuthoredGroupPolicy({
        ...f.input,
        verifiedCurrentPolicy: { ...f.input.verifiedCurrentPolicy },
      }),
    ).rejects.toMatchObject({ code: "invalid_shape" });
    await expect(
      prepareAuthoredGroupPolicy({
        ...f.input,
        localPolicyCheckpoint: {
          ...f.input.localPolicyCheckpoint,
          stateHash: "f".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
  } finally {
    f.close();
  }
});

test("current acknowledgement owns mutable request and receipt inputs before yielding", async () => {
  const f = await currentPolicyAcknowledgementFixture(history, "group");
  try {
    const expectedSignature = f.input.request.state.signature;
    const pending = acknowledgeGroupPolicyState({
      ...f.input,
      response: f.response.currentState,
    });
    f.input.request.state.signature = "substituted";
    f.response.currentState.signature = "substituted";
    f.input.expectedHead.stateHash = "f".repeat(64);
    const policy = await pending;
    expect(policy.state.signature).toBe(expectedSignature);
    expect(policy.stateHash).toBe(f.response.currentState.stateHash);
  } finally {
    f.close();
  }
});

test.each(["prepare", "acknowledge"] as const)(
  "current %s rejects an operation expiring during verification",
  async (operation) => {
    const f = await currentPolicyAcknowledgementFixture(history, "group");
    try {
      const pending =
        operation === "prepare"
          ? prepareAuthoredGroupPolicy(f.input)
          : acknowledgeGroupPolicyState({
              ...f.input,
              response: f.response.currentState,
            });
      f.lifetime.current = false;
      await expect(pending).rejects.toThrow("generation expired");
    } finally {
      f.close();
    }
  },
);

test("current preparation uses its private predecessor and authenticates the successor signature", async () => {
  const f = await currentPolicyAcknowledgementFixture(history, "group");
  try {
    f.input.verifiedCurrentPolicy.state.signature = "changed-public-copy";
    const prepared = await prepareAuthoredGroupPolicy(f.input);
    expect(prepared.retainedHistory[0]?.state.signature).toBe(
      history.group.currentState.signature,
    );
    await expect(
      prepareAuthoredGroupPolicy({
        ...f.input,
        request: {
          ...f.input.request,
          state: { ...f.input.request.state, signature: "AAAA" },
        },
      }),
    ).rejects.toMatchObject({ code: "signature_mismatch" });
    await expect(
      prepareAuthoredGroupPolicy({
        ...f.input,
        expectedHead: {
          ...f.input.expectedHead,
          keyEpoch: f.input.expectedHead.keyEpoch + 1,
        },
      }),
    ).rejects.toThrow("Updated group policy advanced during root re-wrap");
  } finally {
    f.close();
  }
});

test.each(["group", "organization"] as const)(
  "current %s acknowledgement does not replace an older durable pin with its own checkpoint",
  async (kind) => {
    const f = await currentPolicyAcknowledgementFixture(history, kind);
    try {
      const earlier = (
        kind === "group" ? history.group : history.directory
      ).previousStates.at(-1)?.state;
      if (!earlier) throw new Error("Missing historical checkpoint fixture");
      await expect(
        acknowledgeGroupPolicyState({
          ...f.input,
          response: f.response.currentState,
          localPolicyCheckpoint: {
            principalType: earlier.principalType,
            principalId: earlier.principalId,
            version: earlier.version,
            stateHash: earlier.stateHash,
          },
        }),
      ).rejects.toMatchObject({ code: "stale_predecessor" });
    } finally {
      f.close();
    }
  },
);

test.each(["prepare", "acknowledge"] as const)(
  "current %s rejects an operation already expired before verification",
  async (operation) => {
    const f = await currentPolicyAcknowledgementFixture(history, "group");
    try {
      f.lifetime.current = false;
      // Invalid proof must not be reached when the entry guard has expired.
      const input = {
        ...f.input,
        verifiedCurrentPolicy: { ...f.input.verifiedCurrentPolicy },
      };
      await expect(
        operation === "prepare"
          ? prepareAuthoredGroupPolicy(input)
          : acknowledgeGroupPolicyState({
              ...input,
              response: f.response.currentState,
            }),
      ).rejects.toThrow("generation expired");
    } finally {
      f.close();
    }
  },
);
