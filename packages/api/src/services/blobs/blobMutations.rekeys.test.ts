import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import {
  bootstrapRoot,
  buildBindRequest,
  createDocumentFixture,
  registerOnly,
  runtime,
  stageEncryptedBlob,
} from "../../../test/helpers/blobMutationFixtures";
import {
  appendUnexpectedUserWrapToRekey,
  buildRootContainerRekeyMutation,
} from "../../../test/helpers/containerRekey";
import { getCurrentContainerKeyEpoch } from "../../access/read/containerKekStore";
import { bindBlobAttachment } from "./blobMutations";

test("bindBlobAttachment applies optional container rekeys before target validation", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: container,
    signer: owner,
  });
  const document = await createDocumentFixture({
    container: rekey.container,
    owner,
  });
  const blobId = crypto.randomUUID();
  const bind = await buildBindRequest({
    blobId,
    container: rekey.container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "preview",
    stagedBlob: await stageEncryptedBlob({
      blobId,
      owner,
    }),
  });
  bind.request.containerRekeys = [rekey.request];

  const response = await bindBlobAttachment(runtime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: bind.request,
    sessionId: "test-session",
    userId: owner.userId,
  });

  expect(response.blobKekTargets.linkedContainerKeyEpochIds).toEqual([
    rekey.container.kekState.containerKeyEpochId,
  ]);
  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    container.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(
    rekey.container.kekState.containerKeyEpochId,
  );
});

test("bindBlobAttachment rolls back optional rekeys when blob write validation fails", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: container,
    signer: owner,
  });
  const document = await createDocumentFixture({
    container: rekey.container,
    owner,
  });
  const blobId = crypto.randomUUID();
  const bind = await buildBindRequest({
    blobId,
    container: rekey.container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "preview",
    stagedBlob: await stageEncryptedBlob({
      blobId,
      owner,
    }),
  });
  bind.request.containerRekeys = [rekey.request];
  if (!bind.request.stagedBlob) {
    throw new Error("Expected staged blob request");
  }
  bind.request.stagedBlob.writeHeader = {
    ...bind.request.stagedBlob.writeHeader,
    version: 2,
  };

  await expect(
    bindBlobAttachment(runtime, {
      blobId,
      fingerprint: owner.fingerprint,
      request: bind.request,
      sessionId: "test-session",
      userId: owner.userId,
    }),
  ).rejects.toMatchObject({
    status: 400,
  });
  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    container.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(container.kekState.containerKeyEpochId);
});

test("bindBlobAttachment rejects invalid optional container rekeys", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: container,
    signer: owner,
  });
  appendUnexpectedUserWrapToRekey(rekey.request);
  const document = await createDocumentFixture({
    container: rekey.container,
    owner,
  });
  const blobId = crypto.randomUUID();
  const bind = await buildBindRequest({
    blobId,
    container: rekey.container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "preview",
    stagedBlob: await stageEncryptedBlob({
      blobId,
      owner,
    }),
  });
  bind.request.containerRekeys = [rekey.request];

  await expect(
    bindBlobAttachment(runtime, {
      blobId,
      fingerprint: owner.fingerprint,
      request: bind.request,
      sessionId: "test-session",
      userId: owner.userId,
    }),
  ).rejects.toMatchObject({
    message: "container key wrap is not justified by its manifest",
    status: 409,
  });
  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    container.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(container.kekState.containerKeyEpochId);
});
