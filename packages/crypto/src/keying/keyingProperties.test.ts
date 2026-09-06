import { expect, test } from "bun:test";
import fc from "fast-check";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import {
  type ContainerDirectGrant,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  deriveDocumentKekTargets,
  verifyAccessManifestLocalCheckpoint,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifyPrincipalPolicyBundle,
} from "./index";
import {
  buildContainerChain,
  buildKekState,
  buildLinkedDocument,
  checkpointOf,
  containerChainPlanArb,
  containerSuccessor,
  signerPool,
  sortedGrants,
} from "./keyingArbitraries.testFixtures";
import {
  buildPolicyChain,
  type PolicyChain,
  policyBundleAt,
  policyChainPlanArb,
  policyCheckpointOf,
} from "./keyingPolicyArbitraries.testFixtures";
import { createBundle, signPolicyState } from "./principalPolicyTestFixtures";
import { expectVerificationError } from "./testFixtures";

/**
 * Property-based tests over the keying verifiers (#2192 Gate F2). Each
 * property draws a plan, materializes signed manifests or policies from it,
 * checks the honest input is accepted, then applies one forgery and checks
 * the verifier refuses it. The forgeries are the bug classes of the last
 * two months: a grant the event never signed, an omitted key target, a
 * swapped recipient key, a stale manifest, a split projection row, a key
 * epoch reused after a shrink, a same-epoch fork, and a rollback below a
 * device checkpoint.
 */

const RUNS = 8;
let runId = 0;
function label(prefix: string): string {
  runId += 1;
  return `${prefix}-${runId}`;
}

test("property: a manifest whose grants differ from its signed event is refused", async () => {
  await fc.assert(
    fc.asyncProperty(
      containerChainPlanArb,
      fc.integer({ min: 1, max: 3 }),
      async (plan, forgedUser) => {
        const chain = await buildContainerChain(plan, label("forged-grant"));
        const head = chain.manifests.at(-1);
        const previous = chain.manifests.at(-2) ?? null;
        if (!head) throw new Error("chain is never empty");
        const honest = await verifyContainerAccessManifest({
          manifest: head.manifest,
          expectedManifestHash: head.manifestHash,
          event: head.event,
          previousManifest: previous,
          previousContainerPath: previous ? [previous] : [],
        });
        expect(honest.ok).toBe(true);
        const pool = await signerPool();
        const subjectId = pool[forgedUser]?.userId ?? "";
        const existing = head.state.directGrants.find(
          (grant) => grant.subjectId === subjectId,
        );
        const forgedGrant: ContainerDirectGrant = {
          subjectType: "user",
          subjectId,
          accessLevel: existing?.accessLevel === "admin" ? "read" : "admin",
        };
        const forgedManifest = await deriveContainerAccessManifest({
          ...head.state,
          directGrants: sortedGrants([
            ...head.state.directGrants.filter(
              (grant) => grant.subjectId !== subjectId,
            ),
            forgedGrant,
          ]),
        });
        const forged = await verifyContainerAccessManifest({
          manifest: forgedManifest,
          expectedManifestHash: await computeAccessManifestHash(forgedManifest),
          event: head.event,
          previousManifest: previous,
          previousContainerPath: previous ? [previous] : [],
        });
        expect(forged.ok).toBe(false);
      },
    ),
    { numRuns: RUNS },
  );
});

test("property: a document key target set missing a linked container is refused", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(containerChainPlanArb, { minLength: 2, maxLength: 3 }),
      fc.nat(),
      async (plans, pick) => {
        const chains = await Promise.all(
          plans.map((plan) => buildContainerChain(plan, label("target"))),
        );
        const heads = chains.map((chain) => {
          const head = chain.manifests.at(-1);
          if (!head) throw new Error("chain is never empty");
          return head;
        });
        const [creator] = await signerPool();
        if (!creator) throw new Error("signer pool is never empty");
        const states = await Promise.all(
          heads.map((head) => buildKekState(head)),
        );
        const documentManifest = await buildLinkedDocument({
          creator,
          documentId: label("document"),
          heads,
        });
        const honest = await deriveDocumentKekTargets({
          documentManifest,
          linkedContainerManifests: heads,
          containerKekStates: states.map((state) => state.state),
        });
        expect(honest.ok).toBe(true);
        if (honest.ok) {
          expect(honest.value.targets).toHaveLength(heads.length);
        }
        const omitted = pick % heads.length;
        const forged = await deriveDocumentKekTargets({
          documentManifest,
          linkedContainerManifests: heads,
          containerKekStates: states
            .filter((_, index) => index !== omitted)
            .map((state) => state.state),
        });
        expectVerificationError(forged, "missing_dependency");
      },
    ),
    { numRuns: RUNS },
  );
});

test("property: a key wrap addressed to a swapped recipient key is refused", async () => {
  await fc.assert(
    fc.asyncProperty(containerChainPlanArb, async (plan) => {
      const chain = await buildContainerChain(plan, label("swap"));
      const head = chain.manifests.at(-1);
      if (!head) throw new Error("chain is never empty");
      fc.pre(head.state.directGrants.length >= 2);
      const built = await buildKekState(head);
      const [first, second] = built.wraps;
      if (!first || !second) throw new Error("two wraps");
      // Every recipient keeps a wrap, so only the exchanged fingerprints can
      // be the reason for a refusal.
      const swapped = await verifyContainerKekState({
        containerManifest: head,
        keyEpoch: built.keyEpoch,
        userRecipientKeys: built.recipients,
        wraps: built.wraps.map((wrap, index) =>
          index === 0
            ? {
                ...wrap,
                recipientKeyFingerprint: second.recipientKeyFingerprint,
              }
            : index === 1
              ? {
                  ...wrap,
                  recipientKeyFingerprint: first.recipientKeyFingerprint,
                }
              : wrap,
        ),
      });
      expectVerificationError(swapped, "hash_mismatch");
    }),
    { numRuns: RUNS },
  );
});

test("property: a manifest below a device checkpoint is a rollback; the head extending it is accepted", async () => {
  await fc.assert(
    fc.asyncProperty(
      containerChainPlanArb,
      fc.nat(),
      fc.nat(),
      async (plan, pickCheckpoint, pickServed) => {
        const chain = await buildContainerChain(plan, label("rollback"));
        fc.pre(chain.manifests.length >= 2);
        const checkpointIndex =
          1 + (pickCheckpoint % (chain.manifests.length - 1));
        const servedIndex = pickServed % checkpointIndex;
        const checkpointed = chain.manifests[checkpointIndex];
        const served = chain.manifests[servedIndex];
        const head = chain.manifests.at(-1);
        if (!checkpointed || !served || !head)
          throw new Error("indices in range");
        const localCheckpoint = checkpointOf(checkpointed);
        expect(() =>
          verifyAccessManifestLocalCheckpoint({
            current: {
              ...checkpointOf(served),
              previousManifestHash: served.state.previousManifestHash,
            },
            localCheckpoint,
            checkpointPredecessors: [],
          }),
        ).toThrow(expect.objectContaining({ code: "rollback" }));
        expect(() =>
          verifyAccessManifestLocalCheckpoint({
            current: {
              ...checkpointOf(head),
              previousManifestHash: head.state.previousManifestHash,
            },
            localCheckpoint,
            checkpointPredecessors: chain.manifests.slice(
              checkpointIndex + 1,
              -1,
            ),
          }),
        ).not.toThrow();
      },
    ),
    { numRuns: RUNS },
  );
});

test("property: a same-epoch fork of a checkpointed container head is an equivocation", async () => {
  await fc.assert(
    fc.asyncProperty(containerChainPlanArb, fc.nat(), async (plan, pick) => {
      const chain = await buildContainerChain(plan, label("fork"));
      fc.pre(chain.manifests.length >= 2);
      const forkIndex = 1 + (pick % (chain.manifests.length - 1));
      const previous = chain.manifests[forkIndex - 1];
      const honestHead = chain.manifests[forkIndex];
      if (!previous || !honestHead) throw new Error("indices in range");
      // A subject no honest head grants, so the fork differs from the honest
      // head only in the grant the checkpoint never saw.
      const forkSubject = "fork-peer";
      const grant: ContainerDirectGrant = {
        subjectType: "user",
        subjectId: forkSubject,
        accessLevel: "read",
      };
      const fork = await containerSuccessor({
        body: {
          eventType: "container.grant",
          containerKeyEpochId: previous.state.containerKeyEpochId,
          grant,
          referencedPrincipalHead: null,
        },
        previous,
        signer: chain.creator,
        state: {
          directGrants: sortedGrants([
            ...previous.state.directGrants.filter(
              (existing) => existing.subjectId !== forkSubject,
            ),
            grant,
          ]),
        },
      });
      const localCheckpoint = checkpointOf(honestHead);
      const honest = await verifyContainerAccessManifest({
        manifest: honestHead.manifest,
        expectedManifestHash: honestHead.manifestHash,
        event: honestHead.event,
        previousManifest: previous,
        previousContainerPath: [previous],
        localCheckpoint,
      });
      expect(honest.ok).toBe(true);
      const forked = await verifyContainerAccessManifest({
        manifest: fork.manifest,
        expectedManifestHash: fork.manifestHash,
        event: fork.event,
        previousManifest: previous,
        previousContainerPath: [previous],
        localCheckpoint,
      });
      expectVerificationError(forked, "equivocation");
    }),
    { numRuns: RUNS },
  );
});

test("property: removing a policy member without a new key epoch is refused; with one it is accepted", async () => {
  await fc.assert(
    fc.asyncProperty(policyChainPlanArb, fc.nat(), async (plan, pick) => {
      const chain = await buildPolicyChain(plan, label("shrink"));
      const head = chain.states.at(-1);
      if (!head) throw new Error("chain is never empty");
      const removable = head.entry.projection.filter(
        (member) => member.userId !== chain.signer.userId,
      );
      fc.pre(removable.length > 0);
      const removed = removable[pick % removable.length];
      if (!removed) throw new Error("index in range");
      const members = head.entry.projection
        .filter((member) => member.userId !== removed.userId)
        .map(({ userId }) => ({ userId }));
      const successor = (input: {
        readonly keyEpoch: number;
        readonly principalKeyPair: PolicyChain["principalKeyPair"];
      }) =>
        signPolicyState({
          principalId: chain.principalId,
          principalKeyPair: input.principalKeyPair,
          version: head.state.version + 1,
          prevStateHash: head.state.stateHash,
          keyEpoch: input.keyEpoch,
          members,
          signer: chain.signer,
        });
      const previous = chain.states.map((state) => state.entry);
      // Same epoch, same key: the removed member still holds the key.
      const reused = await verifyPrincipalPolicyBundle({
        bundle: createBundle({
          current: await successor({
            keyEpoch: head.state.keyEpoch,
            principalKeyPair: chain.principalKeyPair,
          }),
          previous,
        }),
        signerPublicKeys: [chain.signer],
      });
      expectVerificationError(reused, "key_epoch_reuse");
      const rotated = await verifyPrincipalPolicyBundle({
        bundle: createBundle({
          current: await successor({
            keyEpoch: head.state.keyEpoch + 1,
            principalKeyPair: generateKemSeedAndKeyPair(),
          }),
          previous,
        }),
        signerPublicKeys: [chain.signer],
      });
      expect(rotated.ok).toBe(true);
    }),
    { numRuns: RUNS },
  );
});

test("property: a served projection row the signed policy state does not commit is refused", async () => {
  await fc.assert(
    fc.asyncProperty(policyChainPlanArb, async (plan) => {
      const chain = await buildPolicyChain(plan, label("split-row"));
      const bundle = policyBundleAt(chain, chain.states.length - 1);
      const honest = await verifyPrincipalPolicyBundle({
        bundle,
        signerPublicKeys: [chain.signer],
      });
      expect(honest.ok).toBe(true);
      // The signed state commits to the membership root; a row the server
      // adds to the served projection is not under it.
      const split = await verifyPrincipalPolicyBundle({
        bundle: {
          ...bundle,
          currentProjection: [
            ...bundle.currentProjection,
            { userId: "split-row", role: "member" },
          ],
        },
        signerPublicKeys: [chain.signer],
      });
      expectVerificationError(split, "hash_mismatch");
    }),
    { numRuns: RUNS },
  );
});

test("property: a second signed policy state at a checkpointed version is an equivocation; a lower one is a rollback", async () => {
  await fc.assert(
    fc.asyncProperty(
      policyChainPlanArb,
      fc.nat(),
      fc.nat(),
      async (plan, pickCheckpoint, pickServed) => {
        const chain = await buildPolicyChain(plan, label("split"));
        const checkpointIndex = pickCheckpoint % chain.states.length;
        const checkpointed = chain.states[checkpointIndex];
        const checkpointedKeyPair = chain.keyPairs[checkpointIndex];
        if (!checkpointed || !checkpointedKeyPair) {
          throw new Error("index in range");
        }
        const localCheckpoint = policyCheckpointOf(checkpointed);
        const honest = await verifyPrincipalPolicyBundle({
          bundle: policyBundleAt(chain, chain.states.length - 1),
          localCheckpoint,
          signerPublicKeys: [chain.signer],
        });
        expect(honest.ok).toBe(true);

        // Same version, key, epoch, and members as the checkpointed state; only
        // the signing time differs, so only the hash does.
        const split = await signPolicyState({
          principalId: chain.principalId,
          principalKeyPair: checkpointedKeyPair,
          version: checkpointed.state.version,
          prevStateHash: checkpointed.state.prevStateHash,
          keyEpoch: checkpointed.state.keyEpoch,
          members: checkpointed.entry.projection.map(({ userId }) => ({
            userId,
          })),
          signedAt: "2026-04-26T23:59:00.000Z",
          signer: chain.signer,
        });
        const equivocation = await verifyPrincipalPolicyBundle({
          bundle: createBundle({
            current: split,
            previous: chain.states
              .slice(0, checkpointIndex)
              .map((state) => state.entry),
          }),
          localCheckpoint,
          signerPublicKeys: [chain.signer],
        });
        expectVerificationError(equivocation, "equivocation");

        if (checkpointIndex > 0) {
          const rollback = await verifyPrincipalPolicyBundle({
            bundle: policyBundleAt(chain, pickServed % checkpointIndex),
            localCheckpoint,
            signerPublicKeys: [chain.signer],
          });
          expectVerificationError(rollback, "rollback");
        }
      },
    ),
    { numRuns: RUNS },
  );
});
