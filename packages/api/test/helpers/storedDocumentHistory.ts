import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { VerifiedDocumentLinkSetManifest } from "@tearleads/crypto";
import {
  createContainerManifestFixture,
  createDocumentLinkSetManifestFixture,
  createVerifiedDocumentAccessEvent,
} from "@tearleads/crypto/test-fixtures";
import { storeVerifiedAccessManifest } from "../../src/access/write/accessManifestStore";
import { registerUser } from "./registerUser";

export async function signedDocumentHistory(length: number) {
  const user = createTestUser();
  await registerUser(user);
  const organizationId = crypto.randomUUID();
  const containers = await Promise.all(
    [0, 1].map(async () => {
      const container = await createContainerManifestFixture({
        containerId: crypto.randomUUID(),
        containerKeyEpochId: crypto.randomUUID(),
        organizationId,
        directGrants: [
          { subjectType: "user", subjectId: user.userId, accessLevel: "admin" },
        ],
        signer: user.signing,
        signerUserId: user.userId,
      });
      await storeVerifiedAccessManifest({ verifiedManifest: container }, db);
      return container;
    }),
  );
  const [first, second] = containers;
  if (!first || !second) throw new Error("Missing document containers");
  const documentId = crypto.randomUUID();
  let head: VerifiedDocumentLinkSetManifest | undefined;
  for (let epoch = 1; epoch <= length; epoch += 1) {
    const target = epoch === 1 ? first : second;
    const event = await createVerifiedDocumentAccessEvent({
      body: {
        eventType:
          epoch === 1 || epoch % 2 === 0 ? "document.link" : "document.unlink",
        blobRewraps: [],
        containerId: target.state.containerId,
        containerManifestHash: target.manifestHash,
      },
      dependencyManifestHashes: (epoch === 1 ? [first] : containers).map(
        (container) => container.manifestHash,
      ),
      objectId: documentId,
      organizationId,
      previousManifestHash: head?.manifestHash ?? null,
      signer: user.signing,
      signerUserId: user.userId,
    });
    head = await createDocumentLinkSetManifestFixture({
      documentId,
      event,
      epoch,
      organizationId,
      previousManifestHash: head?.manifestHash ?? null,
      linkedContainerIds: (epoch % 2 === 0 ? containers : [first]).map(
        (container) => container.state.containerId,
      ),
    });
    await storeVerifiedAccessManifest({ verifiedManifest: head }, db);
  }
  if (!head) throw new Error("Missing document head");
  return head;
}
