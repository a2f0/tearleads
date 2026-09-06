import { expect, test } from "bun:test";
import {
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicyExternalAuthority,
  type PrincipalPolicyStateChainEntry,
  type PrincipalStateExternalAuthority,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import {
  createBundle,
  createPolicySigner,
  signPolicyState,
} from "@tearleads/crypto/principal-policy-test-fixtures";
import {
  createNoBrickTraceRecorder,
  type NoBrickOutcome,
  type NoBrickProjection,
  persistNoBrickTrace,
} from "@tearleads/test-utils";

/**
 * Projects runs of the real principal-policy verifier onto the
 * NoBrickedDevice model: the Admins policy is the authority, a child group
 * policy the dependent, and a removed admin the late signer. Every
 * verification is `verifyPrincipalPolicyBundle` against this device's local
 * checkpoint and the served Admins history; the outcome it produced is
 * recorded, and scripts/checkNoBrickProjection.ts replays the trace through
 * TLC. The principal-policy twin of the container scenario, so the #2173
 * shape is projected from the seam #2173 changed.
 */

const DEVICE = "d1";

type Signed = Awaited<ReturnType<typeof signPolicyState>>;
type Signer = Awaited<ReturnType<typeof createPolicySigner>>;

function toHead(state: Signed["state"]): PrincipalStateExternalAuthority {
  return {
    principalType: "group",
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    keyFingerprint: state.keyFingerprint,
  };
}

test("a late-delivered group successor is accepted, and a regression, a removed admin, and a rollback are refused", async () => {
  const removedAdmin = await createPolicySigner("removed-admin");
  const replacementAdmin = await createPolicySigner("replacement-admin");
  const childAdmin = await createPolicySigner("child-admin");
  const signers: Signer[] = [removedAdmin, replacementAdmin, childAdmin];
  const recorder = createNoBrickTraceRecorder("policy-late-delivery", {
    [DEVICE]: 1,
  });

  // Authority version 1: the removed admin still administers Admins.
  const adminV1 = await signPolicyState({
    principalId: "admins",
    version: 1,
    prevStateHash: null,
    members: [{ userId: removedAdmin.userId }],
    signer: removedAdmin,
  });
  const admins: Signed[] = [adminV1];
  // Dependent version 1, held by this device.
  const childV1 = await signPolicyState({
    principalId: "child-group",
    version: 1,
    prevStateHash: null,
    members: [{ userId: childAdmin.userId }],
    signer: childAdmin,
  });
  const chain: Signed[] = [childV1];
  const forged: Signed[] = [];
  let checkpoint: PrincipalPolicyCheckpoint = {
    principalType: "group",
    principalId: childV1.state.principalId,
    version: 1,
    stateHash: childV1.state.stateHash,
  };

  const authorityStates =
    async (): Promise<PrincipalPolicyExternalAuthority> => {
      const current = admins.at(-1);
      if (!current) throw new Error("Admins chain is never empty");
      const verified = await verifyPrincipalPolicyBundle({
        bundle: createBundle({
          current,
          previous: admins.slice(0, -1).map((signed) => signed.entry),
        }),
        signerPublicKeys: signers,
      });
      if (!verified.ok) throw verified.error;
      return {
        currentHead: toHead(current.state),
        states: (verified.value.history ?? []).map((entry) => ({
          head: toHead(entry.state),
          projection: entry.projection,
        })),
      };
    };

  const successor = async (input: {
    readonly signer: Signer;
    readonly previous: Signed;
    readonly cited: Signed;
  }): Promise<Signed> =>
    signPolicyState({
      principalId: childV1.state.principalId,
      version: input.previous.state.version + 1,
      prevStateHash: input.previous.state.stateHash,
      keyEpoch: input.previous.state.keyEpoch + 1,
      members: childV1.entry.projection.map(({ userId }) => ({ userId })),
      projection: childV1.entry.projection,
      externalAuthority: toHead(input.cited.state),
      signer: input.signer,
    });

  const commit = async (signer: Signer): Promise<Signed> => {
    const previous = chain.at(-1);
    const cited = admins.at(-1);
    if (!previous || !cited) throw new Error("chains are never empty");
    const head = await successor({ signer, previous, cited });
    chain.push(head);
    recorder.record({
      action: "CommitDependent",
      late: signer.userId === removedAdmin.userId,
    });
    return head;
  };

  const honestPrefixOf = (head: Signed): number => {
    let current = head;
    while (
      !chain.some(
        (signed) => signed.state.stateHash === current.state.stateHash,
      )
    ) {
      const previous = [...chain, ...forged].find(
        (signed) => signed.state.stateHash === current.state.prevStateHash,
      );
      if (!previous)
        throw new Error("a forged head must extend a served predecessor");
      current = previous;
    }
    return current.state.version;
  };

  const projectionOf = (
    head: Signed,
    authority: PrincipalPolicyExternalAuthority,
  ): NoBrickProjection => ({
    head: head.state.version,
    honestPrefix: honestPrefixOf(head),
    cited: head.state.externalAuthority?.version ?? 1,
    late: head.state.signerUserId === removedAdmin.userId,
    authority: authority.currentHead.version,
  });

  const verify = async (head: Signed): Promise<NoBrickOutcome> => {
    const previous: PrincipalPolicyStateChainEntry[] = [];
    let current: Signed | undefined = head;
    while (current && current.state.version > 1) {
      const prev: Signed | undefined = [...chain, ...forged].find(
        (signed) => signed.state.stateHash === current?.state.prevStateHash,
      );
      if (!prev)
        throw new Error("a served head must extend a served predecessor");
      previous.unshift(prev.entry);
      current = prev;
    }
    const externalAuthority = await authorityStates();
    const result = await verifyPrincipalPolicyBundle({
      bundle: createBundle({ current: head, previous }),
      externalAuthority,
      localCheckpoint: checkpoint,
      signerPublicKeys: signers,
    });
    if (result.ok) {
      checkpoint = {
        principalType: "group",
        principalId: head.state.principalId,
        version: head.state.version,
        stateHash: head.state.stateHash,
      };
      return "accepted";
    }
    return "refused";
  };

  const honestSync = async (): Promise<NoBrickOutcome> => {
    const head = chain.at(-1);
    if (!head) throw new Error("chain is never empty");
    const outcome = await verify(head);
    recorder.record({
      action: "HonestSync",
      device: DEVICE,
      observed: { outcome },
    });
    return outcome;
  };

  const dishonestSync = async (head: Signed): Promise<NoBrickOutcome> => {
    const projection = projectionOf(head, await authorityStates());
    const outcome = await verify(head);
    recorder.record({
      action: "Verify",
      device: DEVICE,
      projection,
      observed: { outcome },
    });
    return outcome;
  };

  // The removed admin's last honest successor, citing Admins@1.
  await commit(removedAdmin);
  // Admins@2 removes that admin.
  admins.push(
    await signPolicyState({
      principalId: adminV1.state.principalId,
      version: 2,
      prevStateHash: adminV1.state.stateHash,
      keyEpoch: 2,
      members: [{ userId: replacementAdmin.userId }],
      projection: [{ userId: replacementAdmin.userId, role: "admin" }],
      signer: removedAdmin,
    }),
  );
  recorder.record({ action: "RevokeLateSigner" });
  // Delivered only now, citing the older Admins head: accepted.
  expect(await honestSync()).toBe("accepted");

  const childV3 = await commit(replacementAdmin);
  expect(await honestSync()).toBe("accepted");

  // The removed admin citing Admins@1 below the head childV3 established.
  const regressed = await successor({
    signer: removedAdmin,
    previous: childV3,
    cited: adminV1,
  });
  forged.push(regressed);
  expect(await dishonestSync(regressed)).toBe("refused");
  // The removed admin citing the head that removed them.
  const current = admins.at(-1);
  if (!current) throw new Error("Admins chain is never empty");
  const unauthorized = await successor({
    signer: removedAdmin,
    previous: childV3,
    cited: current,
  });
  forged.push(unauthorized);
  expect(await dishonestSync(unauthorized)).toBe("refused");
  // The honest version 2 served again below this device's checkpoint.
  const childV2 = chain[1];
  if (!childV2) throw new Error("child chain has version 2");
  expect(await dishonestSync(childV2)).toBe("refused");

  persistNoBrickTrace(recorder.trace());
});
