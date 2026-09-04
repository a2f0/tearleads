import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  buildDetach,
  detachForTest,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
  createSignedAccessEvent,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  readBindBodyClaim,
  readDetachBodyClaim,
} from "../../workflows/blobs/mutations/records";

test("nested attachment bind and detach require exactly their signed full path", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const leaf = {
    ...root,
    bundle: child.accessManifest,
    kekState: kekStateFromContainerResponse(child),
  };
  const containerPath = [root.bundle, child.accessManifest];
  const document = await createDocument({ owner, root: leaf, containerPath });
  const blobId = crypto.randomUUID();
  const bound = await buildBind({
    blobId,
    document,
    owner,
    root: leaf,
    containerPath,
    stagedBlob: await stageBlob(owner),
  });
  const omission = await createSignedAccessEvent({
    body: readBindBodyClaim(bound.request.body),
    dependencyManifestHashes: [
      document.accessManifest.manifestHash,
      child.accessManifest.manifestHash,
    ],
    objectId: blobId,
    objectKind: "blob",
    organizationId: child.organizationId,
    previousManifestHash: null,
    signer: owner,
  });
  await expect(
    bindForTest({
      blobId,
      owner,
      request: { ...bound.request, event: { ...omission.event } },
    }),
  ).rejects.toMatchObject({
    status: 409,
    message: "Attachment event dependencies do not match supplied paths",
  });
  // Rejection leaves the staged blob usable by the exact, fully cited request.
  await bindForTest({ blobId, owner, request: bound.request });
  const detached = await buildDetach({
    binding: bound.binding,
    document,
    owner,
    root: leaf,
    containerPath,
  });
  const extra = await createSignedAccessEvent({
    body: readDetachBodyClaim(detached.body),
    dependencyManifestHashes: [
      document.accessManifest.manifestHash,
      root.bundle.manifestHash,
      child.accessManifest.manifestHash,
      "f".repeat(64),
    ],
    objectId: blobId,
    objectKind: "blob",
    organizationId: child.organizationId,
    previousManifestHash: null,
    signer: owner,
  });
  await expect(
    detachForTest({
      binding: bound.binding,
      blobId,
      owner,
      request: { ...detached, event: { ...extra.event } },
    }),
  ).rejects.toMatchObject({
    status: 409,
    message: "Attachment event dependencies do not match supplied paths",
  });
  await detachForTest({
    binding: bound.binding,
    blobId,
    owner,
    request: detached,
  });
});
