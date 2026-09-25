import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { computeDocumentContentKeyTargetHash } from "@tearleads/crypto";
import { isDocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import { contentKeyEnvelopeFixture } from "../../../test/helpers/contentKeyEnvelope";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { listDocumentContentWriteDependencyHashes } from "../../access/read/contentWriteDependencies";
import { routeApp } from "../../routeApp";

test("a write retains its advanced linked head independently of the original link citation", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const target = {
    containerId: rekey.kekState.containerId,
    containerManifestHash: rekey.bundle.manifestHash,
    containerKeyEpochId: rekey.kekState.containerKeyEpochId,
    containerKeyEpoch: rekey.kekState.containerKeyEpoch,
  };
  expect(target.containerManifestHash).not.toBe(root.bundle.manifestHash);
  const { request } = await createSignedDocumentSyncRequest({
    checkpoint: true,
    created,
    owner,
    root: rekey,
    includeContentKeyBundle: true,
    contentKeyBundle: {
      ...created.contentKeyBundle,
      contentKeyEpoch: 2,
      targetHash: await computeDocumentContentKeyTargetHash([target]),
      targets: [
        {
          ...target,
          ...contentKeyEnvelopeFixture("Document", "advanced-root"),
        },
      ],
    },
  });
  const headers = {
    Authorization: `Bearer ${owner.token}`,
    "Content-Type": "application/json",
  };
  const synced = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...request,
      containerRekeys: [rekey.request],
      inlineRekeyCommitId: "a".repeat(64),
    }),
  });
  if (synced.status !== 200) throw new Error(await synced.text());
  expect(
    await listDocumentContentWriteDependencyHashes(created.id, db),
  ).toEqual([rekey.bundle.manifestHash]);
  const response = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    { headers },
  );
  expect(response.status).toBe(200);
  const projection = await response.json();
  if (!isDocumentWriterProjectionResponse(projection))
    throw new Error("Expected writer projection");
  expect(projection.documentManifest.manifestHash).toBe(
    created.accessManifest.manifestHash,
  );
  const retained = projection.documentManifestContainerPaths
    .flat()
    .map((bundle) => bundle.manifestHash);
  expect(retained).toContain(root.bundle.manifestHash);
  expect(retained).toContain(rekey.bundle.manifestHash);
});
