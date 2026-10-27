import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import {
  ContainerWriterProjectionWireResponseSchema,
  DocumentWriterProjectionWireResponseSchema,
} from "@tearleads/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import {
  decodeServedContainerProjection,
  decodeServedDocumentProjection,
} from "../../test/helpers/servedWriterProjection";
import { routeApp } from "../routeApp";

async function served(path: string, token: string): Promise<unknown> {
  const response = await routeApp.request(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}

test("a document projection serves each manifest once and cites it by hash", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const body = await served(
    `/documents/${created.id}/writer-projection`,
    owner.token,
  );
  const wire = DocumentWriterProjectionWireResponseSchema.parse(body);
  const rootHash = root.bundle.manifestHash;
  // The root manifest is cited by the authorizing path and by the document
  // manifest's dependency path, but travels once.
  expect(wire.documentManifest).toBe(created.accessManifest.manifestHash);
  expect(wire.authorizingContainerPaths.map(({ path }) => path)).toEqual([
    [rootHash],
  ]);
  expect(wire.documentManifestContainerPaths).toEqual([[rootHash]]);
  expect(Object.keys(wire.bundles).sort()).toEqual(
    [rootHash, created.accessManifest.manifestHash].sort(),
  );

  const decoded = decodeServedDocumentProjection(body);
  expect(decoded.documentManifestContainerPaths[0]?.[0]).toEqual(
    wire.bundles[rootHash],
  );
  expect(decoded.authorizingContainerPaths[0]?.path[0]).toEqual(
    wire.bundles[rootHash],
  );
});

test("a container projection cites its path and KEK history by hash", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });

  const body = await served(
    `/containers/${child.containerId}/writer-projection`,
    owner.token,
  );
  const wire = ContainerWriterProjectionWireResponseSchema.parse(body);
  expect(wire.path).toEqual([
    root.bundle.manifestHash,
    child.accessManifest.manifestHash,
  ]);
  const cited = new Set([
    ...wire.path,
    ...wire.containerKeks.flatMap((kek) => kek.containerManifestHistory),
  ]);
  expect(new Set(Object.keys(wire.bundles))).toEqual(cited);

  const decoded = decodeServedContainerProjection(body);
  expect(decoded.path.map((bundle) => bundle.manifestHash)).toEqual(wire.path);
});
