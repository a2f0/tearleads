import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("container deletion binds a subtree request to its current signed ancestry", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const target = await createChildContainer({ parent: root, signer: owner });
  const outside = await createChildContainer({ parent: root, signer: owner });
  const remove = (requiredAncestorId: string) =>
    routeApp.request(
      `/containers/${target.containerId}?requiredAncestorId=${requiredAncestorId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${owner.token}` } },
    );
  const refused = await remove(outside.containerId);
  expect(refused.status).toBe(409);
  expect(
    await db
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.id, target.containerId)),
  ).toHaveLength(1);
  const removed = await remove(
    asVerifiedContainerManifest(root.bundle).state.containerId,
  );
  expect(removed.status).toBe(200);
  expect(
    await db
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.id, target.containerId)),
  ).toHaveLength(0);
}, 10_000);
