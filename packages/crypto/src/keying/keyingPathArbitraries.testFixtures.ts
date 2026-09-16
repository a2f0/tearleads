import fc from "fast-check";
import {
  type ContainerDirectGrant,
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
} from "./index";
import {
  buildContainerChain,
  containerChainPlanArb,
  granteeArb,
  signerPool,
  sortedGrants,
} from "./keyingArbitraries.testFixtures";
import { createContainerManifestFixture } from "./testFixtures";

interface ContainerPathPlan {
  readonly root: Parameters<typeof buildContainerChain>[0];
  readonly children: readonly (readonly {
    readonly user: number;
    readonly level: ContainerDirectGrant["accessLevel"];
  }[])[];
}

const childGrantsArb = fc.uniqueArray(
  fc.record({
    user: granteeArb,
    level: fc.constantFrom("read", "write", "admin"),
  }),
  { maxLength: 3, selector: (grant) => grant.user },
);

/** At least two edges: the leaf signer inherits authority only from the root. */
export const containerPathPlanArb: fc.Arbitrary<ContainerPathPlan> = fc.record({
  root: containerChainPlanArb,
  children: fc.array(childGrantsArb, { minLength: 2, maxLength: 3 }),
});

/** Sign and verify every creation against the complete root-to-parent path. */
export async function buildContainerPath(
  plan: ContainerPathPlan,
  label: string,
): Promise<readonly VerifiedContainerAccessManifest[]> {
  const root = await buildContainerChain(plan.root, `${label}-root`);
  const head = root.manifests.at(-1);
  if (!head) throw new Error("root chain is never empty");
  const path: VerifiedContainerAccessManifest[] = [head];
  const pool = await signerPool();
  for (const [index, grants] of plan.children.entries()) {
    const parent = path.at(-1);
    if (!parent) throw new Error("path is never empty");
    const directGrants: ContainerDirectGrant[] = grants.map((grant) => {
      const signer = pool[grant.user];
      if (!signer) throw new Error("grant must name a pool user");
      return {
        subjectType: "user",
        subjectId: signer.userId,
        accessLevel: grant.level,
      };
    });
    const created = await createContainerManifestFixture({
      containerId: `${label}-child-${index}`,
      directGrants: sortedGrants(directGrants),
      organizationId: head.state.organizationId,
      parentContainerId: parent.state.containerId,
      parentManifestHash: parent.manifestHash,
      signer: root.creator.signing,
      signerUserId: root.creator.userId,
    });
    const verified = await verifyContainerAccessManifest({
      manifest: created.manifest,
      expectedManifestHash: created.manifestHash,
      event: created.event,
      parentContainerPath: path,
    });
    if (!verified.ok) throw verified.error;
    path.push(verified.value);
  }
  return path;
}
