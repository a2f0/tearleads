import { expect, test } from "bun:test";
import fc from "fast-check";
import { verifyContainerAccessManifest } from "./index";
import {
  buildContainerChain,
  containerChainPlanArb,
} from "./keyingArbitraries.testFixtures";
import {
  buildContainerPath,
  containerPathPlanArb,
} from "./keyingPathArbitraries.testFixtures";
import { expectVerificationError } from "./testFixtures";

const RUNS = 8;

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
        "unauthorized",
      );
      expectVerificationError(
        await verify(parentPath.slice(0, -1)),
        "missing_dependency",
      );
    }),
    { numRuns: RUNS },
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
      expectVerificationError(
        await verifyContainerAccessManifest({
          manifest: stale.manifest,
          expectedManifestHash: head.manifestHash,
          event: stale.event,
          previousManifest: stalePrevious,
          previousContainerPath: stalePrevious ? [stalePrevious] : [],
        }),
        "hash_mismatch",
      );
    }),
    { numRuns: RUNS },
  );
});
