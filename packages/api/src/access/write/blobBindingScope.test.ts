import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  attachBlob,
  setDocumentHead,
  targetEnvelopes,
} from "../../../test/helpers/blobContentKeyStoreFixtures";
import { getLatestBlobContentKeyBundle } from "../read/blobContentKeyStore";
import { resolveCurrentBlobKekTargets } from "../read/blobKekTargets";
import { storeBlobContentKeyBundle } from "./blobContentKeyStore";

test("the store itself refuses another slot's envelopes on the same document", async () => {
  const documentId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const bindingIds = [crypto.randomUUID(), crypto.randomUUID()];
  const manifestHash = await setDocumentHead({
    documentId,
    organizationId: crypto.randomUUID(),
    epoch: 1,
    linkedContainerIds: [crypto.randomUUID()],
  });
  for (const [slot, bindingId] of bindingIds.entries()) {
    await attachBlob({
      blobId,
      documentId,
      bindingId,
      documentManifestHash: manifestHash,
      slotId: `slot-${slot}`,
    });
  }
  const all = await resolveCurrentBlobKekTargets(blobId, db);
  const bindingId = bindingIds[1];
  if (!bindingId) throw new Error("Missing second binding");
  // Bypass HTTP authorization entirely. The hash is valid for the complete
  // union, but this transaction may only supply its own binding's envelopes.
  await expect(
    storeBlobContentKeyBundle(
      {
        blobId,
        documentId,
        bindingId,
        contentKeyEpoch: 1,
        targetHash: all.blobKeyTargetHash,
        targets: targetEnvelopes(all),
      },
      db,
    ),
  ).rejects.toThrow(
    "Blob content-key targets do not match current KEK targets",
  );
  expect(await getLatestBlobContentKeyBundle(blobId, db)).toBeNull();
});
