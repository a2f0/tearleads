import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildContainerGrantRequest } from "../../../test/helpers/containerGrantMutation";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocumentRequest,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import {
  assertCurrentContainerPathRefGroups,
  assertCurrentContainerPathRefs,
} from "../../workflows/documents/mutations/shared/verification";

test("current references cannot borrow a sibling's write grant to create a document", async () => {
  const owner = createTestUser();
  const writer = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(writer);
  await authenticate(writer);
  const root = await bootstrapRoot(owner);
  const donor = await createChildContainer({ parent: root, signer: owner });
  const victim = await createChildContainer({ parent: root, signer: owner });
  const grant = await buildContainerGrantRequest({
    accessLevel: "write",
    parentKekState: root.kekState,
    previous: donor.accessManifest,
    previousContainerPath: [root.bundle, donor.accessManifest],
    previousKekState: kekStateFromContainerResponse(donor),
    recipient: writer,
    signer: owner,
  });
  const granted = await routeApp.request(
    `/containers/${donor.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grant),
    },
  );
  expect(granted.status, await granted.clone().text()).toBe(200);
  const donorHead: unknown = await granted.json();
  if (!isContainerMutationResponse(donorHead))
    throw new Error("Expected granted sibling");
  const documentId = crypto.randomUUID();
  const request = await createDocumentRequest({
    owner: writer,
    documentId,
    root: {
      ...root,
      bundle: victim.accessManifest,
      kekState: kekStateFromContainerResponse(victim),
    },
    // Every head is current and signed. The writer has authority only in the
    // donor sibling, which is not an ancestor of the target victim.
    containerPath: [
      root.bundle,
      donorHead.accessManifest,
      victim.accessManifest,
    ],
  });
  const created = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${writer.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  expect(created.status, await created.clone().text()).toBe(409);
  expect(await created.text()).toContain(
    "does not match container parent edges",
  );
  expect(
    await db.select().from(documents).where(eq(documents.id, documentId)),
  ).toEqual([]);

  const victimRef = {
    containerId: victim.containerId,
    manifestHash: victim.accessManifest.manifestHash,
  };
  for (const resolve of [
    () => assertCurrentContainerPathRefs(db, [victimRef], "target"),
    () => assertCurrentContainerPathRefGroups(db, [[victimRef]], "authorizing"),
  ])
    await expect(resolve()).rejects.toThrow(
      "does not start at a root container",
    );
  if (!request.targetContainerPathRefs) throw new Error("Expected target refs");
  await expect(
    assertCurrentContainerPathRefGroups(
      db,
      [request.targetContainerPathRefs],
      "authorizing",
    ),
  ).rejects.toThrow("does not match container parent edges");
});
