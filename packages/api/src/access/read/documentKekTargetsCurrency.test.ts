import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  createVerifiedContainerManifest,
  createVerifiedDocumentLinkSetManifest,
  insertContainerKeyEpoch,
} from "../../../test/helpers/documentContentKeyStoreFixtures";
import { storeVerifiedAccessManifest } from "../write/accessManifestStore";
import {
  assertDocumentKekTargetsCurrent,
  resolveCurrentDocumentKekTargets,
} from "./documentKekTargets";

test("assertDocumentKekTargetsCurrent rejects stale target hashes", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const firstContainerManifest = await createVerifiedContainerManifest({
    containerId,
    organizationId,
    salt: "initial",
  });
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: firstContainerManifest,
    },
    db,
  );
  await insertContainerKeyEpoch({
    containerId,
    keyEpochId: `${containerId}:key-epoch-1`,
    manifestHash: firstContainerManifest.manifestHash,
  });
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [firstContainerManifest.manifestHash],
    documentId,
    linkedContainerIds: [containerId],
    organizationId,
  });
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: documentManifest,
    },
    db,
  );
  const oldTargets = await resolveCurrentDocumentKekTargets(documentId, db);
  const nextContainerManifest = await createVerifiedContainerManifest({
    containerId,
    epoch: 2,
    organizationId,
    previousManifestHash: firstContainerManifest.manifestHash,
    salt: "next",
  });
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: nextContainerManifest,
    },
    db,
  );

  await expect(
    assertDocumentKekTargetsCurrent(
      {
        documentId,
        expectedTargetHash: oldTargets.documentKeyTargetHash,
      },
      db,
    ),
  ).rejects.toMatchObject({
    message: "Document KEK targets are stale",
    status: 409,
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
  });
});
