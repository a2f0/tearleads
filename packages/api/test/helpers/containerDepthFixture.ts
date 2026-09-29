import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "./authenticate";
import { createChildContainer } from "./keyingWriterProjectionChild";
import {
  bootstrapRoot,
  kekStateFromContainerResponse,
  type StoredRootFixture,
} from "./keyingWriterProjectionKit";
import { registerUser } from "./registerUser";

/** A real signed path admitted by the API, with root at depth zero. */
export async function createContainerDepthFixture(depth: number) {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const chain: StoredRootFixture[] = [root];
  for (let nextDepth = 1; nextDepth <= depth; nextDepth += 1) {
    const parent = chain.at(-1);
    if (!parent) throw new Error("Missing depth fixture parent");
    const child = await createChildContainer({
      parent,
      parentPath: chain.slice(0, -1).map((entry) => entry.bundle),
      signer: owner,
    });
    chain.push({
      bundle: child.accessManifest,
      kekState: kekStateFromContainerResponse(child),
      principalPolicies: root.principalPolicies,
    });
  }
  return { owner, root, chain };
}
