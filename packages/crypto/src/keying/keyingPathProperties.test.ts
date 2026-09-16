import { expect, test } from "bun:test";
import fc from "fast-check";
import {
  resolveContainerPathUserAccessLevel,
  resolveHistoricalContainerPathUserAccessLevel,
  verifyContainerAccessManifest,
} from "./index";
import {
  buildContainerChain,
  containerChainPlanArb,
  KEYING_PROPERTY_RUNS,
} from "./keyingArbitraries.testFixtures";
import {
  buildContainerPath,
  containerPathPlanArb,
} from "./keyingPathArbitraries.testFixtures";
import { expectVerificationError } from "./testFixtures";

test("property: inherited creation requires its authorizing root and cited parent", async () => {
  await fc.assert(
    fc.asyncProperty(containerPathPlanArb, async (plan) => {
      const path = await buildContainerPath(plan, "inherited-create");
      const leaf = path.at(-1);
      if (!leaf) throw new Error("path is never empty");
      const parentPath = path.slice(0, -1);
      const verify = (parentContainerPath: typeof path) =>
        verifyContainerAccessManifest({
          manifest: leaf.manifest,
          expectedManifestHash: leaf.manifestHash,
          event: leaf.event,
          parentContainerPath,
        });

      // The signer has no direct grant anywhere below the root. This honest
      // twin needs the inherited authority, including across intermediate nodes.
      expect((await verify(parentPath)).ok).toBe(true);
      expectVerificationError(
        await verify(parentPath.slice(1)),
        "missing_dependency",
      );
      expectVerificationError(
        await verify(parentPath.slice(0, -1)),
        "missing_dependency",
      );
      const unrelated = await buildContainerChain(plan.root, "unrelated-root");
      const unrelatedRoot = unrelated.manifests.at(-1);
      if (!unrelatedRoot) throw new Error("root chain is never empty");
      // Every entry is authentic, and the endpoint is still the cited parent,
      // but the signer cannot borrow authority from a different root's grants.
      const spliced = [unrelatedRoot, ...parentPath.slice(1)];
      expectVerificationError(await verify(spliced), "missing_dependency");
      // Document authorization also uses the public current/historical folds.
      for (const resolve of [
        resolveContainerPathUserAccessLevel,
        resolveHistoricalContainerPathUserAccessLevel,
      ]) {
        const userId = leaf.event.event.signerUserId;
        expect(resolve({ path: parentPath, userId })).toBe("admin");
        expect(() => resolve({ path: spliced, userId })).toThrow(
          "not contiguous",
        );
      }
    }),
    { numRuns: KEYING_PROPERTY_RUNS },
  );
});

test("property: an authentic stale manifest cannot satisfy a requested head hash", async () => {
  await fc.assert(
    fc.asyncProperty(containerChainPlanArb, fc.nat(), async (plan, pick) => {
      // Guarantee a successor without a precondition that discards short plans.
      const chain = await buildContainerChain(
        { ...plan, steps: [...plan.steps, { kind: "rekey" }] },
        "stale-requested-head",
      );
      const head = chain.manifests.at(-1);
      const previous = chain.manifests.at(-2);
      if (!head || !previous) throw new Error("a rekey creates a successor");
      expect(
        (
          await verifyContainerAccessManifest({
            manifest: head.manifest,
            expectedManifestHash: head.manifestHash,
            event: head.event,
            previousManifest: previous,
            previousContainerPath: [previous],
          })
        ).ok,
      ).toBe(true);

      const staleIndex = pick % (chain.manifests.length - 1);
      const stale = chain.manifests[staleIndex];
      if (!stale) throw new Error("stale index must name an earlier manifest");
      const stalePrevious = chain.manifests[staleIndex - 1] ?? null;
      const verifyStale = (expectedManifestHash: string) =>
        verifyContainerAccessManifest({
          manifest: stale.manifest,
          expectedManifestHash,
          event: stale.event,
          previousManifest: stalePrevious,
          previousContainerPath: stalePrevious ? [stalePrevious] : [],
        });
      expect((await verifyStale(stale.manifestHash)).ok).toBe(true);
      expectVerificationError(
        await verifyStale(head.manifestHash),
        "hash_mismatch",
      );
    }),
    { numRuns: KEYING_PROPERTY_RUNS },
  );
});
