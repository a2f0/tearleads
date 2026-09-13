import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../test/helpers/authenticate";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { authorizeContainerAccessWithWorkflow } from "./containerInterestAccess";

test("realtime container authorization uses the signed HTTP read-access workflow", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  for (const user of [owner, outsider]) {
    await registerUser(user);
    await authenticate(user);
  }
  const root = await bootstrapRoot(owner);
  const containerId = asVerifiedContainerManifest(root.bundle).state
    .containerId;
  const child = await createChildContainer({ parent: root, signer: owner });
  const proofs = await authorizeContainerAccessWithWorkflow(owner.userId, [
    containerId,
    child.containerId,
    crypto.randomUUID(),
  ]);
  expect(proofs).toMatchObject([
    { containerId, pathContainerIds: [containerId] },
    {
      containerId: child.containerId,
      pathContainerIds: [containerId, child.containerId],
    },
  ]);
  expect(proofs[1]?.principalKeys.length).toBeGreaterThan(0);
  expect(
    await authorizeContainerAccessWithWorkflow(outsider.userId, [containerId]),
  ).toEqual([]);
});
